// 机场签到脚本 - ikuuu自动签到和流量查询

// 使用方法：

// 1. 将此脚本添加到青龙面板的脚本目录

// 2. 设置环境变量或在脚本中直接配置账号密码

//    多账户设置方式: 使用&或者换行符分隔多个账号和密码

//    例如: IKUUU_USERNAME=account1&account2 IKUUU_PASSWORD=pwd1&pwd2

// 3. 安装依赖: npm install got crypto-js



const got = require('got');

const CryptoJS = require('crypto-js');



// 引入通知模块，添加容错处理

let notify;

try {

    const { sendNotify } = require('./sendNotify');

    notify = sendNotify;

} catch (err) {

    // 如果找不到通知模块，使用空函数代替

    notify = (title, content) => {

        console.log(`${title}\n${content}`);

        return Promise.resolve();

    };

}



// 配置信息

const config = {

    // 登录地址

    loginUrl: 'https://ikuuu.one/auth/login',

    // 签到地址

    checkinUrl: 'https://ikuuu.one/user/checkin',

    // 用户中心地址

    userUrl: 'https://ikuuu.one/user',

    // 网站基础域名

    baseUrl: 'https://ikuuu.one',

    // 是否发送通知

    sendNotify: true

};



// 获取环境变量中的账号密码列表

function getAccountList() {

    const usernames = process.env.IKUUU_USERNAME || 'shuye_886@163.com';

    const passwords = process.env.IKUUU_PASSWORD || 'qwe123..';

    

    // 支持使用&或者换行符分隔多个账号

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



// 创建请求会话

function createSession() {

    return got.extend({

        headers: {

            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',

            'Content-Type': 'application/x-www-form-urlencoded',

            'Accept': 'application/json, text/javascript, */*; q=0.01',

            'X-Requested-With': 'XMLHttpRequest',

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

    

    // 每个账号使用独立的会话

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



// 登录函数

async function loginAccount(request, account) {

    console.log(`[ikuuu] 尝试登录账号: ${account.username}`);

    try {

        const response = await request.post(config.loginUrl, {

            form: {

                email: account.username,

                passwd: account.password,

                code: ''

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

        return false;

    }

}



// 签到函数

async function checkinAccount(request) {

    console.log(`[ikuuu] 开始执行签到`);

    try {

        const response = await request.post(config.checkinUrl).json();

        

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

        const response = await request.get(config.userUrl);

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

        

        // 提取在线设备数 - 优化提取方法

        // 尝试多种模式匹配

        let deviceCount = null;

        

        // 模式1: 直接包含"在线设备数"附近的数字/数字

        const devicePattern1 = /在线设备数[^>]*>\s*<[^>]*>\s*(\d+)\s*\/\s*(\d+)/i;

        const deviceMatch1 = html.match(devicePattern1);

        

        // 模式2: 在页面中寻找格式为"数字/数字"的部分

        const devicePattern2 = /(?:在线设备|devices)[\s\S]{1,100}?(\d+)\s*\/\s*(\d+)/i;

        const deviceMatch2 = html.match(devicePattern2);

        

        // 模式3: 在页面中找所有的"数字/数字"格式

        const devicePattern3 = /(\d+)\s*\/\s*(\d+)/g;

        const allDeviceMatches = [...html.matchAll(devicePattern3)];

        

        if (deviceMatch1) {

            deviceCount = `${deviceMatch1[1]}/${deviceMatch1[2]}`;

        } else if (deviceMatch2) {

            deviceCount = `${deviceMatch2[1]}/${deviceMatch2[2]}`;

        } else if (allDeviceMatches.length > 0) {

            // 通常设备数量格式是0/5或类似格式

            for (const match of allDeviceMatches) {

                // 如果第二个数字是5，很可能是设备数量限制

                if (match[2] === '5') {

                    deviceCount = `${match[1]}/${match[2]}`;

                    break;

                }

            }

            

            // 如果没找到5作为上限的，使用第一个匹配

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

    const accounts = getAccountList();

    console.log(`[ikuuu] 共发现 ${accounts.length} 个账号`);

    

    const results = [];

    let notifyMsg = '';

    

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

            notifyMsg += `- 钱包余额: ${result.userInfo.account.balance}\n\n`;

            

            notifyMsg += `📊 流量信息:\n`;

            notifyMsg += `- 总流量: ${result.userInfo.traffic.total}\n`;

            notifyMsg += `- 今日已用: ${result.userInfo.traffic.used}\n`;

        }

    }

    

    // 输出结果

    console.log(`\n${notifyMsg}`);

    

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
