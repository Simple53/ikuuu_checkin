// 机场签到脚本 - ikuuu自动签到和流量查询
// 适用于青龙面板 / GitHub Actions
// 使用方法：
// 1. 将此脚本添加到青龙面板的脚本目录 或 GitHub 仓库
// 2. 设置环境变量:
//    IKUUU_USERNAME: 账号1&账号2
//    IKUUU_PASSWORD: 密码1&密码2
//    IKUUU_BASE_URL: (可选) 自定义ikuuu域名, 例如 https://ikuuu.de
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
    baseUrl: process.env.IKUUU_BASE_URL || 'https://ikuuu.de', // 默认域名，如果HTML源码来自不同域名请修改这里或设置环境变量
    sendNotify: true,
    debug: process.env.IKUUU_DEBUG === 'true'
};

config.loginUrl = `${config.baseUrl}/auth/login`;
config.checkinUrl = `${config.baseUrl}/user/checkin`;
config.userUrl = `${config.baseUrl}/user`;


// 获取环境变量中的账号密码列表
function getAccountList() {
    const usernames = process.env.IKUUU_USERNAME ;
    const passwords = process.env.IKUUU_PASSWORD ;
    
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
        
        // 签到
        result.checkinResult = await checkinAccount(request);
        
        // 获取用户信息
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


// ----------------- (修改点 5: 更新 getUserInfo 正则表达式) -----------------
// 辅助函数：尝试多个正则模式提取信息
function extractInfo(html, patterns, groupIndex = 1) {
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[groupIndex]) {
            // 清理 HTML 标签和多余空格
            return match[groupIndex].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        }
    }
    return null; // 如果所有模式都未匹配成功
}

// 获取用户信息
async function getUserInfo(request) {
    console.log(`[ikuuu] 开始获取用户信息`);
    try {
        const response = await request.get(config.userUrl, {
            headers: {
                 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9'
            }
        });
        const html = response.body;

        // 如果开启了 DEBUG 模式, 打印 HTML 源码
        if (config.debug) {
            console.log("\n[ikuuu DEBUG] ----------------- HTML 源码开始 -----------------\n");
            console.log(html);
            console.log("\n[ikuuu DEBUG] ----------------- HTML 源码结束 -----------------\n");
        }
        
        // 初始化用户信息对象
        const userInfo = {
            traffic: { total: '获取失败', used: '0B' },
            account: { memberType: '获取失败', deviceCount: '获取失败', balance: '获取失败' }
        };
        
        // 1. 提取会员类型 (基于 HTML 源码更新)
        // 模式1: <h4>会员时长</h4> ... <div class="card-body"> ... 永久 (免费版) ... </div>
        const memberTypePatterns = [
            /<h4>会员时长<\/h4>[\s\S]*?<div class="card-body">\s*([\s\S]*?)\s*<\/div>/i,
            /会员类型.*?>\s*([\s\S]*?)\s*<\//i // 备用模式，可能不准确
        ];
        const memberType = extractInfo(html, memberTypePatterns);
        if (memberType) {
            userInfo.account.memberType = memberType.split('\n').map(s => s.trim()).filter(Boolean).join(' '); // 处理多行情况
        }

        // 2. 提取总流量 (剩余流量) (基于 HTML 源码更新)
        // 模式1: <h4>剩余流量</h4> ... <div class="card-body"> <span class="counter">55.66</span> GB ... </div>
        const totalTrafficPatterns = [
            /<h4>剩余流量<\/h4>[\s\S]*?<div class="card-body">\s*<span[^>]*>([\d\.]+)<\/span>\s*(GB|MB|TB)/i,
            /剩余流量.*?(\d+(\.\d+)?\s*(GB|MB|TB))/i // 备用
        ];
        // 这个需要特殊处理，匹配数字和单位
        let totalTraffic = "获取失败";
        for (const pattern of totalTrafficPatterns) {
            const match = html.match(pattern);
            if (match && match[1] && match[2]) {
                totalTraffic = `${match[1].trim()} ${match[2].trim()}`;
                break;
            }
        }
        userInfo.traffic.total = totalTraffic;


        // 3. 提取今日已用 (基于 HTML 源码更新)
        // 模式1: ... <li class="breadcrumb-item active" ...>今日已用 : 0B</li>
        const usedTodayPatterns = [
            /今日已用\s*:\s*([\d\.]+\s*[BKMGT]?B?)/i, // 匹配 "今日已用 : 0B"
            /今日已用.*?([\d\.]+\s*[BKMGT]?B?)/i // 备用
        ];
        const usedToday = extractInfo(html, usedTodayPatterns);
        if (usedToday) {
            userInfo.traffic.used = usedToday;
        }

        // 4. 提取在线设备数 (基于 HTML 源码更新)
        // 模式1: <h4>在线设备数</h4> ... <span class="counter">0</span> / <span class="counterup">5</span> ...
        const deviceCountPatterns = [
            /<h4>在线设备数<\/h4>[\s\S]*?<span[^>]*>(\d+)<\/span>\s*\/\s*<span[^>]*>(\d+)<\/span>/i,
            /在线设备数.*?(\d+)\s*\/\s*(\d+)/i // 备用
        ];
        // 这个也需要特殊处理
        let deviceCount = "获取失败";
        for (const pattern of deviceCountPatterns) {
            const match = html.match(pattern);
            if (match && match[1] && match[2]) {
                 // 限制数 (match[2]) 不太可能大于 100
                 if (Number(match[2]) < 100) {
                     deviceCount = `${match[1].trim()}/${match[2].trim()}`;
                     break;
                 }
            }
        }
        // 从你的日志看，抓到了 2/55，那个 55 不对，用上面的正则优先匹配 counter/counterup
        if (deviceCount === "获取失败") {
            // 尝试旧的模式作为后备
             const devicePatternOld = /(\d+)\s*\/\s*(\d+)\s*个设备/i;
             const deviceMatchOld = html.match(devicePatternOld);
             if(deviceMatchOld && deviceMatchOld[1] && deviceMatchOld[2]){
                 if (Number(deviceMatchOld[2]) < 100) {
                     deviceCount = `${deviceMatchOld[1].trim()}/${deviceMatchOld[2].trim()}`;
                 }
             }
        }
        userInfo.account.deviceCount = deviceCount;
        
        // 5. 提取钱包余额 (基于 HTML 源码更新)
        // 模式1: <h4>钱包余额</h4> ... ¥ <span class="counter">1.00</span> ...
        const balancePatterns = [
            /<h4>钱包余额<\/h4>[\s\S]*?¥\s*<span[^>]*>([\d\.]+)<\/span>/i,
            /钱包余额.*?¥\s*([\d\.]+)/i // 备用
        ];
        const balance = extractInfo(html, balancePatterns);
        if (balance) {
            userInfo.account.balance = `¥${balance}`;
        }
        
        console.log(`[ikuuu] 获取用户信息完成`);
        return userInfo;
    } catch (error) {
        console.log(`[ikuuu] 获取用户信息异常: ${error}`);
        return {
            traffic: { total: '获取失败', used: '获取失败' },
            account: { memberType: '获取失败', deviceCount: '获取失败', balance: '获取失败' }
        };
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
        
        // 签到结果
        if (result.checkinResult) {
            if (result.checkinResult.success) {
                notifyMsg += `✓ 签到成功: ${result.checkinResult.message}\n\n`;
            } else {
                notifyMsg += `✗ 签到失败: ${result.checkinResult.message}\n\n`;
            }
        }
        
        // 账户信息
        if (result.userInfo) {
            notifyMsg += `👑 账户信息:\n`;
            notifyMsg += `- 会员类型: ${result.userInfo.account.memberType}\n`;
            notifyMsg += `- 在线设备: ${result.userInfo.account.deviceCount}\n`;
            notifyMsg += `- 钱包余额: ${result.userInfo.account.balance}\n\n`;
            
            notifyMsg += `📊 流量信息:\n`;
            notifyMsg += `- 剩余流量: ${result.userInfo.traffic.total}\n`; 
            notifyMsg += `- 今日已用: ${result.userInfo.traffic.used}\n`;
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
        notify('ikuuu签到', `运行异常: ${error}`).catch(e => {
            console.log(`[ikuuu] 发送通知失败: ${e}`);
        });
    } catch (e) {
        console.log(`[ikuuu] 发送通知异常: ${e}`);
    }
});
