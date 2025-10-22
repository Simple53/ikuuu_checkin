// 机场签到脚本 - ikuuu自动签到和流量查询
// 适用于青龙面板 / GitHub Actions
// 使用方法：
// 1. 将此脚本添加到青龙面板的脚本目录 或 GitHub 仓库
// 2. 设置环境变量:
//    IKUUU_USERNAME: 账号1&账号2
//    IKUUU_PASSWORD: 密码1&密码2
//    IKUUU_BASE_URL: (可选) 自定义ikuuu域名, 例如 https://ikuuu.dev
//    IKUUU_DEBUG: (可选) 设为 "true" 来打印 HTML 源码用于调试
// 3. GitHub Actions 依赖: npm install got@11 crypto-js tough-cookie

const got = require('got');
const CryptoJS = require('crypto-js');

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
    baseUrl: process.env.IKUUU_BASE_URL || 'https://ikuuu.de', // 默认域名 .de
    sendNotify: true,
    debug: process.env.IKUUU_DEBUG === 'true'
};

config.loginUrl = `${config.baseUrl}/auth/login`;
config.checkinUrl = `${config.baseUrl}/user/checkin`;
config.userUrl = `${config.baseUrl}/user`;


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

// 处理单个账号
async function processAccount(account) {
    console.log(`\n[ikuuu] 开始处理账号: ${account.username}`);
    let result = {
        success: false,
        username: account.username,
        message: '',
        checkinResult: null,
        userInfo: null
    };

    const request = createSession();

    try {
        const loginSuccess = await loginAccount(request, account);
        if (!loginSuccess) {
            result.message = `[ikuuu] 登录失败，无法继续执行签到和查询`;
            console.log(result.message);
            return result;
        }

        result.success = true;

        result.checkinResult = await checkinAccount(request);

        result.userInfo = await getUserInfo(request);

        return result;
    } catch (error) {
        console.log(`[ikuuu] 处理账号异常: ${error}`);
        result.message = `处理异常: ${error}`;
        return result;
    }
}


// 登录函数
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


// 签到函数
async function checkinAccount(request) {
    console.log(`[ikuuu] 开始执行签到`);
    try {
        const response = await request.post(config.checkinUrl, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': config.userUrl
            }
        }).json();

        if (response.ret === 1) {
            console.log(`[ikuuu] 签到成功: ${response.msg}`);
            return { success: true, message: response.msg };
        } else {
            console.log(`[ikuuu] 签到失败: ${response.msg}`);
            return { success: false, message: response.msg };
        }
    } catch (error) {
        console.log(`[ikuuu] 签到请求异常: ${error}`);
        return { success: false, message: `请求异常: ${error}` };
    }
}


// ----------------- (修改点 8: 使用更宽松的 Regex) -----------------
// 获取用户信息
async function getUserInfo(request) {
    console.log(`[ikuuu] 开始获取用户信息`);
    const defaultUserInfo = {
        traffic: { total: '获取失败', used: '0B' },
        account: { memberType: '获取失败', deviceCount: '获取失败', balance: '获取失败' }
    };

    try {
        const response = await request.get(config.userUrl, {
            headers: {
                 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9'
            }
        });
        const html = response.body;

        if (config.debug) {
            console.log("\n[ikuuu DEBUG] ----------------- HTML 源码开始 -----------------\n");
            console.log(html);
            console.log("\n[ikuuu DEBUG] ----------------- HTML 源码结束 -----------------\n");
        }

        const userInfo = JSON.parse(JSON.stringify(defaultUserInfo)); // 深拷贝默认值

        console.log('[ikuuu DEBUG] 开始解析HTML...');

        // 1. 提取会员类型 (更宽松，匹配 card-body 内部内容)
        const memberTypeRegex = /<h4>会员时长<\/h4>[\s\S]*?<div class="card-body">([\s\S]*?)<\/div>/i;
        const memberTypeMatch = html.match(memberTypeRegex);
        const memberTypeText = memberTypeMatch ? memberTypeMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null;
        console.log('[ikuuu DEBUG] 会员类型匹配结果:', memberTypeText);
        if (memberTypeText) {
            userInfo.account.memberType = memberTypeText;
        }

        // 2. 提取剩余流量 (更宽松，匹配 counter span 和后面的单位)
        const totalTrafficRegex = /<h4>剩余流量<\/h4>[\s\S]*?<span class="counter">([\d\.]+)<\/span>\s*(GB|MB|TB)/i;
        const totalTrafficMatch = html.match(totalTrafficRegex);
        const totalTrafficText = totalTrafficMatch ? `${totalTrafficMatch[1]} ${totalTrafficMatch[2]}` : null;
        console.log('[ikuuu DEBUG] 剩余流量匹配结果:', totalTrafficText);
        if (totalTrafficText) {
            userInfo.traffic.total = totalTrafficText;
        }

        // 3. 提取今日已用 (保持之前的精确匹配，因为它工作了)
        const usedTodayRegex = /今日已用\s*:\s*([\d\.]+\s*[BKMGT]?B?)/i;
        const usedTodayMatch = html.match(usedTodayRegex);
        const usedTodayText = usedTodayMatch ? usedTodayMatch[1].trim() : null;
        console.log('[ikuuu DEBUG] 今日已用匹配结果:', usedTodayText);
        if (usedTodayText !== null) { // 检查是否为 null，即使是 0B 也是有效匹配
            userInfo.traffic.used = usedTodayText;
        } else {
             userInfo.traffic.used = '获取失败'; // 明确设置为失败
        }

        // 4. 提取在线设备数 (更宽松，不要求 counterup 类)
        const deviceCountRegex = /<h4>在线设备数<\/h4>[\s\S]*?<span[^>]*>(\d+)<\/span>\s*\/\s*<span[^>]*>(\d+)<\/span>/i;
        const deviceCountMatch = html.match(deviceCountRegex);
        const deviceCountText = deviceCountMatch ? `${deviceCountMatch[1]}/${deviceCountMatch[2]}` : null;
        console.log('[ikuuu DEBUG] 在线设备匹配结果:', deviceCountText);
        if (deviceCountText) {
            userInfo.account.deviceCount = deviceCountText;
        }

        // 5. 提取钱包余额 (更宽松，匹配 ¥ 符号和 counter span)
        const balanceRegex = /<h4>钱包余额<\/h4>[\s\S]*?¥\s*<span class="counter">([\d\.]+)<\/span>/i;
        const balanceMatch = html.match(balanceRegex);
        const balanceText = balanceMatch ? `¥${balanceMatch[1]}` : null;
        console.log('[ikuuu DEBUG] 钱包余额匹配结果:', balanceText);
        if (balanceText) {
            userInfo.account.balance = balanceText;
        }

        console.log(`[ikuuu] 获取用户信息完成，解析结果见下:`);
        console.log('[ikuuu DEBUG] 解析后的 userInfo 对象:', userInfo);
        return userInfo;
    } catch (error) {
        console.log(`[ikuuu] 获取用户信息异常: ${error}`);
        return defaultUserInfo;
    }
}
// ----------------- (修改结束) -----------------


// 主函数
async function main() {
    console.log('[ikuuu] 开始执行签到任务');
    console.log(`[ikuuu] 当前使用域名: ${config.baseUrl}`);
    if (config.debug) {
        console.log('[ikuuu] ***** DEBUG 模式已开启 *****');
    }
    const accounts = getAccountList();
    console.log(`[ikuuu] 共发现 ${accounts.length} 个账号`);

    const results = [];
    let notifyMsg = `ikuuu 签到域名: ${config.baseUrl}\n`;

    for (let i = 0; i < accounts.length; i++) {
        const result = await processAccount(accounts[i]);
        results.push(result);

        notifyMsg += `\n============ 账号 ${i+1}: ${result.username} ============\n`;

        if (!result.success) {
            notifyMsg += `${result.message}\n`;
            continue;
        }

        if (result.checkinResult) {
            notifyMsg += result.checkinResult.success
              ? `✓ 签到成功: ${result.checkinResult.message}\n\n`
              : `✗ 签到失败: ${result.checkinResult.message}\n\n`;
        } else {
            notifyMsg += `? 签到步骤未执行或异常\n\n`;
        }

        if (result.userInfo) {
            notifyMsg += `👑 账户信息:\n`;
            notifyMsg += `- 会员类型: ${result.userInfo.account.memberType}\n`;
            notifyMsg += `- 在线设备: ${result.userInfo.account.deviceCount}\n`;
            notifyMsg += `- 钱包余额: ${result.userInfo.account.balance}\n\n`;

            notifyMsg += `📊 流量信息:\n`;
            notifyMsg += `- 剩余流量: ${result.userInfo.traffic.total}\n`;
            notifyMsg += `- 今日已用: ${result.userInfo.traffic.used}\n`;
        } else {
            notifyMsg += `\n无法获取账户信息。\n`;
        }
    }

    if (config.sendNotify) {
        try {
            await notify('ikuuu多账户签到结果', notifyMsg);
        } catch (error) {
            console.log(`[ikuuu] 发送通知失败: ${error}`);
        }
    }
}

// 执行主函数
main().catch(error => {
    console.log(`[ikuuu] 运行异常: ${error}`);
    try {
        notify('ikuuu签到脚本运行异常', `错误详情: ${error}`).catch(e => {
            console.log(`[ikuuu] 发送异常通知失败: ${e}`);
        });
    } catch (e) {
        console.log(`[ikuuu] 尝试发送异常通知时发生异常: ${e}`);
    }
});
