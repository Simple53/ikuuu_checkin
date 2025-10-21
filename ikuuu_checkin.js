// 机场签到脚本 - ikuuu自动签到和流量查询
// 适用于青龙面板 / GitHub Actions
// 使用方法：
// 1. 将此脚本添加到青龙面板的脚本目录 或 GitHub 仓库
// 2. 设置环境变量:
//    IKUUU_USERNAME: 账号1&账号2
//    IKUUU_PASSWORD: 密码1&密码2
//    IKUUU_BASE_URL: (可选) 自定义ikuuu域名, 例如 https://ikuuu.de
// 3. GitHub Actions 依赖: npm install got@11 crypto-js tough-cookie

const got = require('got');
const CryptoJS = require('crypto-js');

// 引入通知模块，添加容错处理
let notify;
try {
    const { sendNotify } = require('./sendNotify');
    notify = sendNotify;
} catch (err) {
    // 如果找不到通知模块（例如在 GitHub Actions 中），使用 console.log 代替
    notify = (title, content) => {
        console.log(`\n${title}\n${content}`);
        return Promise.resolve();
    };
}

// ----------------- (修改点 1: 优化 Config) -----------------
// 配置信息
const config = {
    // 网站基础域名 (环境变量优先, 否则使用 .club 作为默认)
    // 如果 .club 失效, 尝试修改为 .dev / .co / .top 等
    baseUrl: process.env.IKUUU_BASE_URL || 'https://ikuuu.de',
    // 是否发送通知
    sendNotify: true
};

// 动态生成其他 URL
config.loginUrl = `${config.baseUrl}/auth/login`;
config.checkinUrl = `${config.baseUrl}/user/checkin`;
config.userUrl = `${config.baseUrl}/user`;
// ----------------- (修改结束) -----------------


// 获取环境变量中的账号密码列表
function getAccountList() {
    const usernames = process.env.IKUUU_USERNAME || 'shuye_886@163.com';
    const passwords = process.env.IKUUU_PASSWORD || 'qwe123..';
    
    const usernameList = usernames.split(/[&\n]/).map(item => item.trim()).filter(Boolean);
    const passwordList = passwords.split(/[&\n]/).map(item => item.trim()).filter(Boolean);
    
    const result = [];
    
    for (let i = 0; i < usernameList.length; i++) {
        result.push({
            username: usernameList[i],
            password: passwordList[i] || passwordList[passwordList.length - 1] // 如果密码不够，使用最后一个密码
        });
    }
    
    return result;
}

// ----------------- (修改点 2: 优化 Session) -----------------
// 创建请求会话
function createSession() {
    return got.extend({
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
            'Referer': config.baseUrl // 基本 Referer
            // 移除 Content-Type, Accept, X-Requested-With, 让它们在具体请求中定义
        },
        followRedirect: true,
        retry: {
            limit: 2,
        },
        cookieJar: new (require('tough-cookie')).CookieJar()
    });
}
// ----------------- (修改结束) -----------------

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
        // 登录
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


// ----------------- (修改点 3: 增加 GET 请求) -----------------
// 登录函数
async function loginAccount(request, account) {
    console.log(`[ikuuu] 尝试登录账号: ${account.username} @ ${config.baseUrl}`);
    try {
        // 1. 先 GET 访问一次登录页面，以获取 session 和 cookie
        console.log(`[ikuuu] 正在访问登录页面以初始化 session...`);
        await request.get(config.loginUrl, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9'
            }
        });
        console.log(`[ikuuu] Session 初始化完成.`);

        // 2. 使用同一个 request 实例（携带了 cookieJar）发起 POST 登录
        console.log(`[ikuuu] 正在 POST 登录数据...`);
        const response = await request.post(config.loginUrl, {
            form: {
                email: account.username,
                passwd: account.password,
                code: ''
            },
            // 覆盖 session 的默认 headers，改为 AJAX POST 所需的
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': config.loginUrl // 将 Referer 更新为登录页
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
// ----------------- (修改结束) -----------------


// 签到函数
async function checkinAccount(request) {
    console.log(`[ikuuu] 开始执行签到`);
    try {
        const response = await request.post(config.checkinUrl, {
            // 签到也需要 AJAX 头部
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': config.userUrl // Referer 设为用户中心
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
        
        // 初始化用户信息对象
        const userInfo = {
            traffic: {
                total: '获取失败',
                used: '0B'
            },
            account: {
                memberType: '获取失败',
                deviceCount: '获取失败',
                balance: '获取失败'
            }
        };
        
        // ... (原有的 HTML 解析逻辑不变) ...
        // 从响应HTML中提取流量信息
        const totalTraffic = html.match(/剩余流量：(\d+\s+\w+)/);
        const usedToday = html.match(/今日已用：(\d+\s*\w*)/);
        
        if (totalTraffic && totalTraffic[1]) {
            userInfo.traffic.total = totalTraffic[1].trim();
        } else {
            const totalGBMatch = html.match(/([0-9.]+)\s*GB/);
            if (totalGBMatch && totalGBMatch[1]) {
                userInfo.traffic.total = `${totalGBMatch[1]} GB`;
            }
        }
        
        if (usedToday && usedToday[1]) {
            userInfo.traffic.used = usedToday[1].trim();
        } else {
            const usedTodayMatch = html.match(/今日已用：\s*([0-9.]+[B|KB|MB|GB|TB]*)/i);
            if (usedTodayMatch && usedTodayMatch[1]) {
                userInfo.traffic.used = usedTodayMatch[1].trim();
            }
        }
        
        // 提取会员类型信息
        const membershipMatch = html.match(/会员时长[\s\S]*?<\/div>[\s\S]*?<div[^>]*>([^<]*永久[^<]*)<\/div>/i) || 
                              html.match(/永久\s*\(免费版\)/) || 
                              html.match(/会员时长[\s\S]*?<div[^>]*>(.*?)<\/div>/i);
                              
        if (membershipMatch) {
            userInfo.account.memberType = membershipMatch[1].trim();
        } else if (html.includes('永久') || html.includes('免费版')) {
            userInfo.account.memberType = '永久 (免费版)';
        }
        
        // 提取在线设备数
        let deviceCount = null;
        const devicePattern1 = /在线设备数[^>]*>\s*<[^>]*>\s*(\d+)\s*\/\s*(\d+)/i;
        const deviceMatch1 = html.match(devicePattern1);
        const devicePattern2 = /(?:在线设备|devices)[\s\S]{1,100}?(\d+)\s*\/\s*(\d+)/i;
        const deviceMatch2 = html.match(devicePattern2);
        const devicePattern3 = /(\d+)\s*\/\s*(\d+)/g;
        const allDeviceMatches = [...html.matchAll(devicePattern3)];
        
        if (deviceMatch1) {
            deviceCount = `${deviceMatch1[1]}/${deviceMatch1[2]}`;
        } else if (deviceMatch2) {
            deviceCount = `${deviceMatch2[1]}/${deviceMatch2[2]}`;
        } else if (allDeviceMatches.length > 0) {
            for (const match of allDeviceMatches) {
                if (match[2] === '5') {
                    deviceCount = `${match[1]}/${match[2]}`;
                    break;
                }
            }
            if (!deviceCount && allDeviceMatches.length > 0) {
                const firstMatch = allDeviceMatches[0];
                deviceCount = `${firstMatch[1]}/${firstMatch[2]}`;
            }
        }
        userInfo.account.deviceCount = deviceCount || '获取失败';
        
        // 提取钱包余额
        const balanceMatch = html.match(/钱包余额[^>]*>[^<]*?¥\s*(\d+(\.\d+)?)/i) || 
                          html.match(/¥\s*(\d+(\.\d+)?)/);
                           
        if (balanceMatch) {
            userInfo.account.balance = `¥${balanceMatch[1].trim()}`;
        } else if (html.includes('¥0') || html.includes('¥ 0')) {
            userInfo.account.balance = '¥0';
        }
        
        console.log(`[ikuuu] 获取用户信息成功`);
        return userInfo;
    } catch (error) {
        console.log(`[ikuuu] 获取用户信息异常: ${error}`);
        return {
            traffic: { total: '获取失败', used: '获取失败' },
            account: { memberType: '获取失败', deviceCount: '获取失败', balance: '获取失败' }
        };
    }
}

// 主函数
async function main() {
    console.log('[ikuuu] 开始执行签到任务');
    console.log(`[ikuuu] 当前使用域名: ${config.baseUrl}`);
    const accounts = getAccountList();
    console.log(`[ikuuu] 共发现 ${accounts.length} 个账号`);
    
    const results = [];
    let notifyMsg = `ikuuu 签到域名: ${config.baseUrl}\n`; // 在通知中也显示域名
    
    // 依次处理每个账号
    for (let i = 0; i < accounts.length; i++) {
        const result = await processAccount(accounts[i]);
        results.push(result);
        
        // 构建该账号的消息
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
    _         notifyMsg += `- 钱包余额: ${result.userInfo.account.balance}\n\n`;
            
            notifyMsg += `📊 流量信息:\n`;
            notifyMsg += `- 总流量: ${result.userInfo.traffic.total}\n`;
            notifyMsg += `- 今日已用: ${result.userInfo.traffic.used}\n`;
        }
    }
    
    // 输出结果到日志 (GitHub Actions 会捕获这个)
    // console.log(`\n${notifyMsg}`); // notify 函数已经包含了 console.log
    
    // 发送通知
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
