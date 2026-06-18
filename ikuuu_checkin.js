// 机场签到脚本 - ikuuu自动签到 (仅签到功能)
// 适用于青龙面板 / GitHub Actions
// 使用方法：
// 1. 将此脚本添加到青龙面板的脚本目录 或 GitHub 仓库
// 2. 设置环境变量:
//    IKUUU_USERNAME: 账号1&账号2
//    IKUUU_PASSWORD: 密码1&密码2
//    IKUUU_BASE_URL: (可选) 自定义ikuuu域名, 例如 https://ikuuu.dev
// 3. GitHub Actions 依赖: npm install got@11 crypto-js tough-cookie

const got = require('got');
const CryptoJS = require('crypto-js'); // CryptoJS 实际上在这个简化版中不再需要，但保留以防未来扩展

// 引入通知模块，添加容错处理
let notify;
try {
    const { sendNotify } = require('./sendNotify');
    notify = sendNotify;
} catch (err) {
    notify = (title, content) => {
        console.log(`\n${title}\n${content}`);
        return Promise.resolve();
    };
}

// 配置信息
const config = {
    baseUrl: process.env.IKUUU_BASE_URL, // 默认域名 .de
    sendNotify: true,
    // debug 标志保留，但不再打印HTML
    debug: process.env.IKUUU_DEBUG === 'true'
};

config.loginUrl = `${config.baseUrl}/auth/login`;
config.checkinUrl = `${config.baseUrl}/user/checkin`;
config.userUrl = `${config.baseUrl}/user`; // 保留 userUrl 作为签到请求的 Referer


// 获取环境变量中的账号密码列表
function getAccountList() {
    const usernames = process.env.IKUUU_USERNAME || 'YOUR_EMAIL'; // 确保设置了 Secrets
    const passwords = process.env.IKUUU_PASSWORD || 'YOUR_PASSWORD'; // 确保设置了 Secrets

    const usernameList = usernames.split(/[&\n]/).map(item => item.trim()).filter(Boolean);
    const passwordList = passwords.split(/[&\n]/).map(item => item.trim()).filter(Boolean);

    const result = [];

    for (let i = 0; i < usernameList.length; i++) {
        result.push({
            username: usernameList[i],
            password: passwordList[i] || passwordList[passwordList.length - 1]
        });
    }

    return result;
}

// 创建请求会话
function createSession() {
    return got.extend({
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
            'Referer': config.baseUrl
        },
        followRedirect: true,
        retry: {
            limit: 2,
        },
        cookieJar: new (require('tough-cookie')).CookieJar()
    });
}

// 处理单个账号（仅登录和签到）
async function processAccount(account) {
    console.log(`\n[ikuuu] 开始处理账号: ${account.username}`);
    let result = {
        success: false, // 指登录是否成功
        username: account.username,
        message: '',
        checkinResult: null // 存储签到具体结果
    };

    const request = createSession();

    try {
        // 登录
        const loginSuccess = await loginAccount(request, account);
        if (!loginSuccess) {
            result.message = `[ikuuu] 登录失败，无法继续执行签到`;
            console.log(result.message);
            return result; // 登录失败，直接返回
        }

        result.success = true; // 登录成功

        // 签到
        result.checkinResult = await checkinAccount(request);

        // 用户信息获取已移除

        return result;
    } catch (error) {
        console.log(`[ikuuu] 处理账号 ${account.username} 异常: ${error}`);
        result.message = `处理异常: ${error}`;
        result.success = false; // 确保异常时 success 为 false
        return result;
    }
}


// 登录函数 (不变)
async function loginAccount(request, account) {
    console.log(`[ikuuu] 尝试登录账号: ${account.username} @ ${config.baseUrl}`);
    try {
        console.log(`[ikuuu] 正在访问登录页面以初始化 session...`);
        await request.get(config.loginUrl, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9'
            }
        });
        console.log(`[ikuuu] Session 初始化完成.`);

        console.log(`[ikuuu] 正在 POST 登录数据...`);
        const response = await request.post(config.loginUrl, {
            form: {
                email: account.username,
                passwd: account.password,
                code: ''
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': config.loginUrl
            }
        }).json();

        if (response.ret === 1) {
            console.log(`[ikuuu] 登录成功`);
            return true;
        } else {
            console.log(`[ikuuu] 登录失败: ${response.msg}`);
            return false;
        }
    } catch (error) {
        console.log(`[ikuuu] 登录请求异常: ${error}`);
        if (error.response) {
            console.log(`[ikuuu] 响应状态码: ${error.response.statusCode}`);
            if (error.response.statusCode === 405) {
                 console.log("[ikuuu] 提示: 仍然是 405 错误。这说明 baseUrl ('" + config.baseUrl + "') 很可能还是不对。");
                 console.log("[ikuuu] 请尝试修改脚本中的 baseUrl, 或设置 GitHub Secret 'IKUUU_BASE_URL' 为最新的域名。");
            }
        }
        return false;
    }
}


// 签到函数 (不变)
async function checkinAccount(request) {
    console.log(`[ikuuu] 开始执行签到`);
    try {
        const response = await request.post(config.checkinUrl, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': config.userUrl // 使用 userUrl 作为 Referer
            }
        }).json();

        // 直接返回 API 的响应消息
        return { success: response.ret === 1, message: response.msg };

    } catch (error) {
        console.log(`[ikuuu] 签到请求异常: ${error}`);
        return { success: false, message: `请求异常: ${error}` };
    }
}

// getUserInfo 函数已移除

// 主函数 (简化)
async function main() {
    console.log('[ikuuu] 开始执行签到任务');
    console.log(`[ikuuu] 当前使用域名: ${config.baseUrl}`);
    if (config.debug) {
        console.log('[ikuuu] ***** DEBUG 模式已开启 *****');
    }
    const accounts = getAccountList();
    console.log(`[ikuuu] 共发现 ${accounts.length} 个账号`);

    let notifyTitle = 'ikuuu 签到结果';
    let notifyMsg = `签到域名: ${config.baseUrl}\n`;
    let allSuccess = true; // 标记是否所有账号都成功

    for (let i = 0; i < accounts.length; i++) {
        const result = await processAccount(accounts[i]);

        notifyMsg += `\n============ 账号 ${i + 1}: ${result.username} ============\n`;

        if (!result.success) { // 登录失败
            notifyMsg += `登录失败: ${result.message}\n`;
            allSuccess = false;
        } else if (result.checkinResult) { // 登录成功，检查签到结果
            if (result.checkinResult.success) {
                notifyMsg += `✓ 签到成功: ${result.checkinResult.message}\n`;
            } else {
                notifyMsg += `✗ 签到失败: ${result.checkinResult.message}\n`;
                // 注意：签到失败（如已签到）不算作整体任务失败
            }
        } else { // 登录成功但签到步骤异常
             notifyMsg += `? 签到步骤异常\n`;
             allSuccess = false;
        }
        // 用户信息部分已移除
    }

    // 根据执行结果调整通知标题
    if (!allSuccess) {
        notifyTitle = '【失败】ikuuu 签到异常';
    }

    if (config.sendNotify) {
        try {
            await notify(notifyTitle, notifyMsg);
        } catch (error) {
            console.log(`[ikuuu] 发送通知失败: ${error}`);
        }
    } else {
        // 如果禁用通知，仍在日志中打印最终消息
        console.log(`\n${notifyTitle}\n${notifyMsg}`);
    }
}

// 执行主函数
main().catch(error => {
    console.log(`[ikuuu] 脚本运行异常: ${error}`);
    try {
        notify('ikuuu签到脚本运行异常', `错误详情: ${error}`).catch(e => {
            console.log(`[ikuuu] 发送异常通知失败: ${e}`);
        });
    } catch (e) {
        console.log(`[ikuuu] 尝试发送异常通知时发生异常: ${e}`);
    }
});
