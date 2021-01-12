let express = require('express');
let JSZhuyin = require('jszhuyin').JSZhuyin;
let Discord = require('discord.js');
let exec = require('child_process').exec;
let version = require('./package.json').version;
let fs = require("fs");
let Base64 = require('js-base64').Base64;
let BFRead = require('brainfuck-node');


let prefix = require('./config.json').prefix;

let args = process.argv.slice(2);
let tokenType = args.length != 0 ? args[0] : "token";

let tokenList = require('./token.json');
let token;
if (tokenList[tokenType]) {
    token = tokenList[tokenType];
} else {
    tokenList = tokenList["token"]
}


// 解決 heroku 超過 60 秒未動作就關連接埠的問題
let PORT = process.env.PORT || 5000;
express().listen(PORT, () => console.log(`Listening on ${PORT}`));

let client = new Discord.Client();
let keyMap = "1234567890-qwertyuiopasdfghjkl;zxcvbnm,./";
let zhuyinMap = "ㄅㄉˇˋㄓˊ˙ㄚㄞㄢㄦㄆㄊㄍㄐㄔㄗㄧㄛㄟㄣㄇㄋㄎㄑㄕㄘㄨㄜㄠㄤㄈㄌㄏㄒㄖㄙㄩㄝㄡㄥ";

// Discord bot 指令前綴
let re = {
    /* 尾綴有空格 */
    tr: new RegExp(`^[\ \n]*${prefix}tr[\ \n]+`),
    trRaw: new RegExp(`^[\ \n]*${prefix}tr-raw[\ \n]+`),
    download: new RegExp(`^[\ \n]*${prefix}download[\ \n]+`),
    b64d: new RegExp(`^[\ \n]*${prefix}b64d[\ \n]+`),
    b64e: new RegExp(`^[\ \n]*${prefix}b64e[\ \n]+`),
    bf64e: new RegExp(`^[\ \n]*${prefix}bf64e[\ \n]+`),
    bf64d: new RegExp(`^[\ \n]*${prefix}bf64d[\ \n]+`),

    /* 尾綴沒有空格 */
    help: new RegExp(`^[\ \n]*${prefix}help`),
    about: new RegExp(`^[\ \n]*${prefix}about`),
}

// bot 相關指令與共用值
class Bot {

    constructor(msg) {
        this.srcMsg = msg;
        this.botMsg = null;
        this.botEmbed = null;

        this.bf = new Brainfuck();
    }

    /**
     * 回覆普通訊息
     * @param {string} message
     * @returns {void}
     */
    async replyMessage(message) {
        this.botMsg = await this.srcMsg.reply(message);
    }

    /**
     * 編輯普通訊息 
     * @param {string} message
     * @returns {void}
     */
    async editMessage(message) {
        if (this.botMsg) {
            this.botMsg = await this.botMsg.edit(message);
        }
    }

    /**
     * 發送嵌入式訊息
     * @param {string} message
     * @returns {void} 
     */
    async sendEmbed(message) {
        let exampleEmbed = new Discord.MessageEmbed()
            .setColor('#0099ff')
            // .setTitle('標題')
            .setURL('https://discord.js.org/#標題連結')
            .setAuthor(client.user.username, client.user.avatarURL, 'https://discord.js.org/#作者連結')
            .setDescription('')
            .addField("", "")
            .setTimestamp();

        this.botEmbed = await this.srcMsg.channel.send(exampleEmbed);
    }

    /**
     * 下載 Youtube 影片（轉 mp3 格式）並上傳至 Discord
     * @param {string} url
     * @returns {void}
     */
    async downloadMP3(url) {
        try {
            let metadata = await new Promise((resolve, reject) => exec(`./bin/ytdl -j ${url}`, (err, std, ste) => resolve(JSON.parse(std))));

            let title = metadata.title;
            let duration = metadata.duration;
            let id = metadata.id;

            let timestamp = Date.now();
            let target = `${id}_${timestamp}.mp3`;

            console.log("download start");
            this.replyMessage(`\`開始下載... ${title}\``);

            // 改用指令形式
            exec(`./bin/ytdl --extract-audio --audio-format mp3 "${id}" -o "${target}"`, (error, stdout, stderr) => {
                if (error) {
                    console.error(error);
                } else {
                    console.info(stdout);

                    let files = [{
                        file: target,
                        name: title
                    }];
                    this.uploadFiles(files, true);
                    console.log("download completed!");
                }
            });
        } catch (e) {
            console.error("ERROR", e);
        }
    }

    /**
     * 上傳檔案，當 `remove == true` 時將在上傳完刪除檔案
     * @param {string[]} files
     * @param {boolean} remove
     * @returns {void}
     */
    async uploadFiles(files, remove = false) {
        this.editMessage("下載完成！");
        await this.srcMsg.channel.send(`\`${files[0].name}\``, {
            files: files.map(each => each.file)
        });

        if (remove) {
            files.forEach(f => fs.unlinkSync(f.file));
        }
    }

    /**
     * 翻譯注音亂碼
     * @param {string} message 
     * @returns {void}
     */
    translate(message) {
        let matches = message.match(/[0-9a-zA-Z;,-\/\.\ ]+/g);

        if (matches) {
            let placeholder = message.replace(/[0-9a-zA-Z;,-\/\.\ ]+/g, "{bopomofo}");
            let over = false;

            matches.forEach(each => {
                if (each.length <= 200) {
                    let result = each.toLowerCase().split("").map(char => zhuyinMap[keyMap.indexOf(char)]).join("");
                    let candidates = [];

                    const jszhuyin = new JSZhuyin();
                    jszhuyin.load();

                    jszhuyin.oncandidateschange = function (c) {
                        candidates = c;
                    };
                    jszhuyin.handleKey(result);

                    try {
                        let translation = candidates[0][0];
                        placeholder = placeholder.replace("{bopomofo}", `\`${translation}\``);
                    } catch {
                        // 例外處理：保留原始文字
                        placeholder = placeholder.replace("{bopomofo}", `\`${each}\``);
                    }
                } else {
                    over = true;
                    placeholder = placeholder.replace("{bopomofo}", `\`${each}\``);
                }
            });

            if (over) {
                placeholder += ` ---- \`部分文字超過上限（200 個字元），保持原始內容。\``;
            }

            if (placeholder.length > 2000) {
                this.replyMessage("回覆文字超過上限（2000 字）");
            } else {
                this.replyMessage(placeholder);
            }
        } else {
            this.replyMessage(`${message} \`(找不到可翻譯的文字)\``);
        }
    }

    /**
     * 翻譯注音亂碼（輸出注音）
     * @param {string} message 
     * @returns {void}
     */
    translateRaw(message) {
        let matches = message.match(/[0-9a-zA-Z;,-\/\.\ ]+/g);

        if (matches) {
            let placeholder = message.replace(/[0-9a-zA-Z;,-\/\.\ ]+/g, "{bopomofo}");

            matches.forEach(each => {
                let result = each.split("").map(char => zhuyinMap[keyMap.indexOf(char)]).join("");

                placeholder = placeholder.replace("{bopomofo}", `\`${result}\``);
            });

            if (placeholder.length > 2000) {
                this.replyMessage("回覆文字超過上限（2000 字）");
            } else {
                this.replyMessage(placeholder);
            }
        } else {
            this.replyMessage(`${message} \`(找不到可翻譯的文字)\``);
        }
    }

    /**
     * Base64 編碼
     * @param {string} message 
     * @returns {void} 
     */
    base64Encode(message) {
        this.replyMessage(Base64.encode(message));
    }

    /**
     * Base64 解碼
     * @param {string} message 
     * @returns {void} 
     */
    base64Decode(message) {
        message = message.split(/[^A-Za-z0-9\/+=]/).filter(e => e != "")[0];
        this.replyMessage(Base64.decode(message));
    }

    /**
     * Brainfuck 編碼
     * @param {string} message 
     * @returns {void} 
     */
    brainfuckEncode(message) {
        message = Base64.encode(message);
        message = this.bf.encode(message);
        this.replyMessage(message);
    }

    /**
     * Brainfuck 解碼
     * @param {string} message 
     * @returns {void} 
     */
    brainfuckDecode(message) {
        message = message.split(/[^><+-\.,\[\]]/).filter(e => e != "")[0];
        message = this.bf.decode(message).output;
        message = Base64.decode(message);
        this.replyMessage(message);
    }

    /**
     * 機器人使用幫助
     * @returns {object} botEmbed
     */
    async help() {
        let exampleEmbed = new Discord.MessageEmbed()
            .setColor('#0099ff')
            // .setTitle('標題')
            .setURL('https://discord.js.org/#標題連結')
            .setAuthor(client.user.username, client.user.avatarURL)
            .setDescription('')
            .addField("tr: 翻譯注音亂碼（輸出中文）", `\`\`\`diff\n# 注音翻譯員\n${prefix}tr 5j4up z0 u4m06\`\`\``)
            .addField("tr-raw: 翻譯注音亂碼（輸出注音）", `\`\`\`diff\n# ㄓㄨˋㄧㄣㄈㄢㄧˋㄩㄢˊ\n${prefix}tr-raw 5j4up z0 u4m06\`\`\``)
            .addField("download: 下載影片成音樂檔（格式一律爲 MP3，多個時以空格分隔）", `\`\`\`diff\n# 此指令僅支援單一影片（不支援清單），網址部分支援多種格式：\n# 單一影片格式，如 https://www.youtube.com/watch?v=kBH-dO68ooA\n# 清單內的格式，如 https://www.youtube.com/watch?v=X_CJ5M6CV5U&list=PLh4FRo5L-pLn6R94HCH2_zROyq4qa_lF4&index=14\n# 單一影片 ID，如 xVcPheK3dYM\n${prefix}download 6Gx-eg9qwf8 G1OJVOleBu4\`\`\``)
            .addField("【進階】b64d: Base64 Decode", `\`\`\`diff\n# 解碼\n${prefix}b64d 6Kej56K8\`\`\``)
            .addField("【進階】b64e: Base64 Encode", `\`\`\`diff\n# 57eo56K8\n${prefix}b64e 編碼\`\`\``)
            .addField("【嘎語翻譯機】bf64d: Brainfuck + Base64 Decode。非純粹 BF 轉換，加上 base64 轉碼可以避免非 ASCII 文字轉換後編碼過長。", `\`\`\`diff\n# 解碼\n${prefix}bf64d ++++++++++[>+++++>++++++++>++++++++++>+++++++++++>++++++<<<<<-]>++++.>-----.>+.>----.<<<-.+.>.<++. \`\`\``)
            .addField("【嘎語翻譯機】bf64e: Brainfuck + Base64 Encode。非純粹 BF 轉換，加上 base64 轉碼可以避免非 ASCII 文字轉換後編碼過長。", `\`\`\`diff\n# ++++++++++[>+++++>++++++>++++++++++>+++++++++++>++++++++<<<<<-]>+++.++.>>+.>+.<<<--.+.>>>>-----.<<<<++.\n${prefix}bf64e 編碼\`\`\``)
            .addField("help: 顯示這條訊息", `\`\`\`diff\n${prefix}help\`\`\``)
            .addField(`about: 關於${client.user.username}`, `\`\`\`diff\n${prefix}about\`\`\``);

        this.botEmbed = await this.srcMsg.channel.send(exampleEmbed);
        return this.botEmbed;
    }

    /**
     * 關於機器人
     * @returns {void}
     */
    about() {
        this.replyMessage(`
        只是用一大堆套件兜出的破爛玩意兒。
\`開發套件的人都是好人。\`
`);
    }
}

// bot 版本與登錄時間
class Status {
    constructor(client) {
        this.type = "PLAYING";
        this.client = client;
        this.version = version;
        this.loginTime = Date.now().toString().substr(0, 10);
        this.updateStatus();
    }

    /**
     * 更新狀態
     * @param {object} client 
     */
    updateStatus() {
        let now = Date.now().toString().substr(0, 10);
        let ago = this.timeFormat(now - this.loginTime);
        console.log(now - this.loginTime, ago);
        this.client.user.setActivity(`v${this.version}, 最後登錄於 ${ago}`, {
            type: this.type
        });

        setTimeout(() => {
            this.updateStatus();
        }, 1e4);
    }

    /**
     * 格式化時間
     * @param {number} ts 
     * @returns {string} dd 天 hh 時 mm 分 ss 秒前
     */
    timeFormat(sec) {
        let result = "";

        let s = ("0" + sec % 60).substr(-2);
        let m = ("0" + ((sec % 3600 - sec % 60) / 60)).substr(-2);
        let h = ("0" + ((sec % 86400 - sec % 3600) / 3600)).substr(-2);
        let d = ("0" + ((sec - sec % 86400) / 86400)).substr(-2);

        result = `${s} 秒前`;

        if (m != "00") {
            result = `${m} 分 ${result}`;
        }
        if (h != "00") {
            result = `${h} 時 ${result}`;
        }
        if (d != "00") {
            result = `${d} 天 ${result}`;
        }

        return result;
    }
}

// Brainfuck Text 編碼與解碼
// 編碼器接受所有文字
// 解碼器只接受 ASCII
class Brainfuck {
    constructor() {
        this.reader = new BFRead();
    }

    encode(input) {
        function StringBuilder() {
            var sb = {};

            sb.value = '';
            sb.append = (txt) => sb.value += txt;

            return sb;
        }

        function closest(num, arr) {
            var arr2 = arr.map((n) => Math.abs(num - n))
            var min = Math.min.apply(null, arr2);
            return arr[arr2.indexOf(min)];
        }

        function buildBaseTable(arr) {
            var out = StringBuilder();
            out.append('+'.repeat(10));
            out.append('[')
            arr.forEach(function (cc) {
                out.append('>');
                out.append('+'.repeat(cc / 10));
            });
            out.append('<'.repeat(arr.length));
            out.append('-');

            out.append(']');
            return out.value;
        }

        var output = StringBuilder();

        var charArray = input.split('').map((c) => c.charCodeAt(0));
        var baseTable = charArray.map((c) => Math.round(c / 10) * 10).filter((i, p, s) => s.indexOf(i) === p);

        output.append(buildBaseTable(baseTable));

        var pos = -1;
        charArray.forEach(function (charCode) {
            var bestNum = closest(charCode, baseTable);
            var bestPos = baseTable.indexOf(bestNum);

            var moveChar = pos < bestPos ? '>' : '<';
            output.append(moveChar.repeat(Math.abs(pos - bestPos)))
            pos = bestPos;

            var opChar = baseTable[pos] < charCode ? '+' : '-';
            output.append(opChar.repeat(Math.abs(baseTable[pos] - charCode)));
            output.append('.');
            baseTable[pos] = charCode;
        });

        return output.value;
    }

    decode(input) {
        let bf = this.reader;

        return bf.execute(input);
    }
}

// 上線事件
client.on('ready', async () => {
    new Status(client);
    console.log(`已成功登錄：${client.user.tag}`);
});

// 接收訊息事件
client.on('message', async msg => {
    let bot = new Bot(msg);

    // 排除 bot 自身訊息
    if (!msg.author.bot) {
        // !!tr
        if (msg.content.match(re.tr)) {
            let message = msg.content.replace(re.tr, "");
            bot.translate(message);
        }

        // !!tr-raw
        if (msg.content.match(re.trRaw)) {
            let message = msg.content.replace(re.trRaw, "");
            bot.translateRaw(message);
        }

        // !!help
        if (msg.content.match(re.help)) {
            bot.help();
        }

        // !!about
        if (msg.content.match(re.about)) {
            bot.about();
        }

        // !!download 
        if (msg.content.match(re.download)) {
            let URLs = msg.content.replace(re.download, "").split(/\ +/);

            URLs.forEach(url => bot.downloadMP3(url));
        }

        // !!b64e 
        if (msg.content.match(re.b64e)) {
            let message = msg.content.replace(re.b64e, "");
            bot.base64Encode(message);
        }

        // !!b64d
        if (msg.content.match(re.b64d)) {
            let message = msg.content.replace(re.b64d, "");
            bot.base64Decode(message);
        }

        // !!bf64e
        if (msg.content.match(re.bf64e)) {
            let message = msg.content.replace(re.bf64e, "");
            bot.brainfuckEncode(message);
        }

        // !!bf64d
        if (msg.content.match(re.bf64d)) {
            let message = msg.content.replace(re.bf64d, "");
            bot.brainfuckDecode(message);
        }

        // debug
        if (msg.content === "!!debug") {
            bot.downloadMP3("https://www.youtube.com/watch?v=G1OJVOleBu4&list=PLh4FRo5L-pLn6R94HCH2_zROyq4qa_lF4&index=5");
        }
    }
});

client.login(token);