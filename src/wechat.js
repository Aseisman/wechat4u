"use strict"
const EventEmitter = require('events')
const axios = require('axios')
const debug = require('debug')('wechat')
const CM = require('cookie-manager')

// Setting
axios.defaults.paramsSerializer = (params) => {
  let qs = []
  for (let key in params)
    qs.push(`${key}=${params[key]}`)
  return encodeURI(qs.join('&'))
}

// Private Method
const _getTime = () => new Date().getTime()
const _convertEmoji = (s) => {
  return s.replace(/<span.*?class="emoji emoji(.*?)"><\/span>/g, (a, b) => {
    try {
      let s = null
      if (b.length == 4 || b.length == 5) {
        s = ['0x' + b]
      } else if (b.length == 8) {
        s = ['0x' + b.slice(0, 4), '0x' + b.slice(4, 8)]
      } else if (b.length == 10) {
        s = ['0x' + b.slice(0, 5), '0x' + b.slice(5, 10)]
      } else {
        throw new Error('unknown emoji characters')
      }
      return String.fromCodePoint.apply(null, s)
    } catch (err) {
      debug(b, err)
      return ' '
    }
  })
}
// 这样是不是不太优雅。。。而且有个bug。。。
// const _contentPrase = (s) => _convertEmoji(s.replace('&lt;', '<').replace('&gt;', '>').replce('<br/>', '\n'))

// Private Property
const webProp = Symbol()
const STATE = {
  init: 0,
  uuid: 1,
  login: 2,
  logout: 3
}

exports = module.exports = class wechat extends EventEmitter {
  static STATE() {
    return STATE
  }

  constructor() {
    super()
    this[webProp] = {
      uuid: '',
      baseUri: '',
      rediUri: '',
      uin: '',
      sid: '',
      skey: '',
      passTicket: '',
      formateSyncKey: '',
      deviceId: 'e' + Math.random().toString().substring(2, 17),

      API_synccheck: '',

      baseRequest: {},
      syncKey: {},
      specialUserNames: ['newsapp', 'fmessage', 'filehelper', 'weibo', 'qqmail', 'fmessage', 'tmessage', 'qmessage', 'qqsync', 'floatbottle', 'lbsapp', 'shakeapp', 'medianote', 'qqfriend', 'readerapp', 'blogapp', 'facebookapp', 'masssendapp', 'meishiapp', 'feedsapp', 'voip', 'blogappweixin', 'weixin', 'brandsessionholder', 'weixinreminder', 'wxid_novlwrv3lqwv11', 'gh_22b87fa7cb3c', 'officialaccounts', 'notification_messages', 'wxid_novlwrv3lqwv11', 'gh_22b87fa7cb3c', 'wxitil', 'userexperience_alarm', 'notification_messages'],
    }
    this.state = STATE.init

    this.on('uuid', () => {})
    this.on('scan', () => {})
    this.on('confirm', () => {})
    this.on('login', () => {})
    this.on('logout', () => {})
    this.on('error', err => debug(err))

    this.on('init-message', () => {})
    this.on('text-message', msg => this._msgAutoReply(msg)) //默认上机器人！
    this.on('picture-message', () => {})
    this.on('voice-message', () => {})

    this.on('mobile-open', () => {})

    this.user = [] // 登陆用户
    this.memberList = [] // 所有好友

    this.contactList = [] // 个人好友
    this.groupList = [] // 群
    this.publicList = [] // 公众账号
    this.specialList = [] // 特殊账号

    this.credibleUser = new Set()

    this.axios = axios
    if (typeof window == "undefined") {
      this.cm = new CM()
      this.axios.defaults.headers.common['user-agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/48.0.2564.109 Safari/537.36'
      this.axios.interceptors.request.use(config => {
        config.headers['cookie'] = decodeURIComponent(this.cm.prepare(config.url))
        return config
      }, err => {
        return Promise.reject(err)
      })
      this.axios.interceptors.response.use(res => {
        let cookies = res.headers['set-cookie']
        if (cookies)
          this.cm.store(res.config.url, cookies)
        return res
      }, err => {
        return Promise.reject(err)
      })
    }
  }

  get friendList() {
    let members = []

    this.groupList.forEach((member) => {
      members.push({
        username: member['UserName'],
        nickname: '群聊: ' + _convertEmoji(member['NickName']),
        switch: false
      })
    })

    this.contactList.forEach((member) => {
      members.push({
        username: member['UserName'],
        nickname: member['RemarkName'] ? _convertEmoji(member['RemarkName']) : _convertEmoji(member['NickName']),
        switch: false
      })
    })

    return members
  }

  switchUser(uid) {
    if (this.credibleUser.has(uid)) {
      this.credibleUser.delete(uid)
      this.sendMsg('机器人小助手和您拜拜咯，下次再见！', uid)

      debug('Add', this.credibleUser)
    } else {
      this.credibleUser.add(uid)
      this.sendMsg('我是' + this.user['NickName'] + '的机器人小助手，欢迎调戏！如有打扰请多多谅解', uid)

      debug('Add', this.credibleUser)
    }
    return Promise.resolve()
  }

  sendMsg(msg, to) {
    let params = {
      'pass_ticket': this[webProp].passTicket
    }
    let clientMsgId = _getTime() + '0' + Math.random().toString().substring(2, 5)
    let data = {
      'BaseRequest': this[webProp].baseRequest,
      'Msg': {
        'Type': 1,
        'Content': msg,
        'FromUserName': this.user['UserName'],
        'ToUserName': to,
        'LocalID': clientMsgId,
        'ClientMsgId': clientMsgId
      }
    }
    this.axios({
      method: 'POST',
      url: '/webwxsendmsg',
      baseURL: this[webProp].baseUri,
      params: params,
      data: data
    }).then(res => {
      let data = res.data
      if (data['BaseResponse']['Ret'] !== 0)
        throw new Error(data['BaseResponse']['Ret'])
    }).catch(err => {
      debug(err)
      throw new Error('发送信息失败')
    })
  }

  getUUID() {
    let params = {
      'appid': 'wx782c26e4c19acffb',
      'fun': 'new',
      'lang': 'zh_CN'
    }
    return this.axios({
      method: 'POST',
      url: 'https://login.weixin.qq.com/jslogin',
      params: params
    }).then(res => {
      this.emit('uuid')
      this.state = STATE.uuid

      let re = /window.QRLogin.code = (\d+); window.QRLogin.uuid = "(\S+?)"/
      let pm = res.data.match(re)
      if (!pm) {
        throw new Error("GET UUID ERROR")
      }
      let code = pm[1]
      let uuid = this[webProp].uuid = pm[2]

      if (code != 200) {
        throw new Error("GET UUID ERROR")
      }

      return uuid
    }).catch(err => {
      debug(err)
      throw new Error('获取UUID失败')
    })
  }

  checkScan() {
    let params = {
      'tip': 1,
      'uuid': this[webProp].uuid,
    }
    return this.axios({
      method: 'GET',
      url: 'https://login.weixin.qq.com/cgi-bin/mmwebwx-bin/login',
      params: params
    }).then(res => {
      let re = /window.code=(\d+);/
      let pm = res.data.match(re)
      let code = pm[1]

      if (code == 201) {
        return code
      } else if (code == 408) {
        throw new Error(code)
      } else {
        throw new Error(code)
      }
    }).catch(err => {
      debug(err)
      throw new Error('获取扫描状态信息失败')
    })
  }

  checkLogin() {
    let params = {
      'tip': 0,
      'uuid': this[webProp].uuid,
    }
    return this.axios({
      method: 'GET',
      url: 'https://login.weixin.qq.com/cgi-bin/mmwebwx-bin/login',
      params: params
    }).then(res => {
      let re = /window.code=(\d+);/
      let pm = res.data.match(re)
      let code = pm[1]

      if (code == 200) {
        let re = /window.redirect_uri="(\S+?)";/
        let pm = res.data.match(re)
        this[webProp].rediUri = pm[1] + '&fun=new'
        this[webProp].baseUri = this[webProp].rediUri.substring(0, this[webProp].rediUri.lastIndexOf("/"))

        // webpush 接口更新
        this._webpushUpdate(this[webProp].baseUri)

        return code
      } else {
        throw new Error(code)
      }

    }).catch(err => {
      debug(err)
      throw new Error('获取确认登录信息失败')
    })
  }

  login() {
    return this.axios({
      method: 'GET',
      url: this[webProp].rediUri
    }).then(res => {
      this[webProp].skey = res.data.match(/<skey>(.*)<\/skey>/)[1]
      this[webProp].sid = res.data.match(/<wxsid>(.*)<\/wxsid>/)[1]
      this[webProp].uin = res.data.match(/<wxuin>(.*)<\/wxuin>/)[1]
      this[webProp].passTicket = res.data.match(/<pass_ticket>(.*)<\/pass_ticket>/)[1]

      this[webProp].baseRequest = {
        'Uin': parseInt(this[webProp].uin, 10),
        'Sid': this[webProp].sid,
        'Skey': this[webProp].skey,
        'DeviceID': this[webProp].deviceId
      }

      debug('login Success')
    }).catch(err => {
      debug(err)
      throw new Error('登录失败')
    })
  }

  init() {
    let params = {
      'pass_ticket': this[webProp].passTicket,
      'skey': this[webProp].skey,
      'r': _getTime()
    }
    let data = {
      BaseRequest: this[webProp].baseRequest
    }
    return this.axios({
      method: 'POST',
      url: '/webwxinit',
      baseURL: this[webProp].baseUri,
      params: params,
      data: data
    }).then(res => {
      let data = res.data
      this[webProp].syncKey = data['SyncKey']
      this.user = data['User']

      let synckeylist = []
      for (let e = this[webProp].syncKey['List'], o = 0, n = e.length; n > o; o++)
        synckeylist.push(e[o]['Key'] + "_" + e[o]['Val'])
      this[webProp].formateSyncKey = synckeylist.join("|")

      debug('wechatInit Success')

      if (data['BaseResponse']['Ret'] !== 0)
        throw new Error(data['BaseResponse']['Ret'])
      return true
    }).catch(err => {
      debug(err)
      throw new Error('微信初始化失败')
    })
  }

  notifyMobile() {
    let params = {
      'lang': 'zh_CN',
      'pass_ticket': this[webProp].passTicket,
    }
    let data = {
      'BaseRequest': this[webProp].baseRequest,
      'Code': 3,
      'FromUserName': this.user['UserName'],
      'ToUserName': this.user['UserName'],
      'ClientMsgId': _getTime()
    }
    return this.axios({
      method: 'POST',
      url: '/webwxstatusnotify',
      baseURL: this[webProp].baseUri,
      data: data
    }).then(res => {
      let data = res.data
      debug('notifyMobile Success')
      if (data['BaseResponse']['Ret'] !== 0)
        throw new Error(data['BaseResponse']['Ret'])
      return true
    }).catch(err => {
      debug(err)
      throw new Error('开启状态通知失败')
    })
  }

  getContact() {
    let params = {
      'lang': 'zh_CN',
      'pass_ticket': this[webProp].passTicket,
      'seq': 0,
      'skey': this[webProp].skey,
      'r': _getTime()
    }
    return this.axios({
      method: 'POST',
      url: '/webwxgetcontact',
      baseURL: this[webProp].baseUri,
      params: params
    }).then(res => {
      let data = res.data
      this.memberList = data['MemberList']

      for (let member in this.memberList) {
        if (this.memberList[member]['VerifyFlag'] & 8) {
          this.publicList.push(this.memberList[member])
        } else if (this[webProp].specialUserNames.indexOf(this.memberList[member]['UserName']) > -1) {
          this.specialList.push(this.memberList[member])
        } else if (this.memberList[member]['UserName'].indexOf('@@') > -1) {
          this.groupList.push(this.memberList[member])
        } else {
          this.contactList.push(this.memberList[member])
        }
      }

      debug(this.memberList.length, ' contacts detected')
      debug(this.publicList.length, ' publicList')
      debug(this.specialList.length, ' specialList')
      debug(this.groupList.length, ' groupList')
      debug(this.contactList.length, ' contactList')

      return this.memberList
    }).catch(err => {
      debug(err)
      throw new Error('获取通讯录失败')
    })
  }

  sync() {
    let params = {
      'sid': this[webProp].sid,
      'skey': this[webProp].skey,
      'pass_ticket': this[webProp].passTicket
    }
    let data = {
      'BaseRequest': this[webProp].baseRequest,
      "SyncKey": this[webProp].syncKey,
      'rr': ~_getTime()
    }
    return this.axios({
      method: 'POST',
      url: '/webwxsync',
      baseURL: this[webProp].baseUri,
      params: params,
      data: data
    }).then(res => {
      let data = res.data
      if (data['BaseResponse']['Ret'] == 0) {
        this[webProp].syncKey = data['SyncKey']
        let synckeylist = []
        for (let e = this[webProp].syncKey['List'], o = 0, n = e.length; n > o; o++)
          synckeylist.push(e[o]['Key'] + "_" + e[o]['Val'])
        this[webProp].formateSyncKey = synckeylist.join("|")
      }

      return data
    }).catch(err => {
      debug(err)
      throw new Error('获取新信息失败')
    })
  }

  syncCheck() {
    let params = {
      'r': _getTime(),
      'sid': this[webProp].sid,
      'uin': this[webProp].uin,
      'skey': this[webProp].skey,
      'deviceid': this[webProp].deviceId,
      'synckey': this[webProp].formateSyncKey
    }
    return this.axios({
      method: 'GET',
      url: this[webProp].API_synccheck,
      params: params,
    }).then(res => {
      let re = /window.synccheck={retcode:"(\d+)",selector:"(\d+)"}/
      let pm = res.data.match(re)

      let retcode = pm[1]
      let selector = pm[2]

      return {
        retcode, selector
      }
    }).catch(err => {
      debug(err)
      throw new Error('同步失败')
    })
  }

  handleMsg(data) {
    debug('Receive ', data['AddMsgList'].length, 'Message')

    data['AddMsgList'].forEach((msg) => {
      let type = msg['MsgType']
      let fromUser = this._getUserRemarkName(msg['FromUserName'])
      let content = msg['Content']

      switch (type) {
        case 51:
          debug(' Message: Wechat Init')
          this.emit('init-message')
          break
        case 1:
          debug(' Text-Message: ', fromUser, ': ', content)
          this.emit('text-message', msg)
          break
        case 3:
          debug(' Picture-Message: ', fromUser, ': ', content)
          this.emit('picture-message', msg)
          break
        case 34:
          debug(' Voice-Message: ', fromUser, ': ', content)
          this.emit('voice-message', msg)
          break
      }
    })
  }

  syncPolling() {
    this.state = STATE.login
    this.syncCheck().then(state => {
      if (state.retcode == '1100' || state.retcode == '1101') {
        this.state = STATE.logout
        debug(state.retcode == '1100' ? '你登出了微信' : '你在其他地方登录了 WEB 版微信')
        this.emit('logout', state.retcode == '1100' ? '你登出了微信' : '你在其他地方登录了 WEB 版微信')
      } else if (state.retcode == '0') {
        if (state.selector == '2') {
          this.sync().then(data => {
            this.handleMsg(data)
            this.syncPolling()
          }).catch(err => {
            throw err
          })
        } else if (state.selector == '7') {
          debug('Mobile Open')
          this.emit('mobile-open')
          this.syncPolling()
        } else if (state.selector == '0') {
          debug('Normal')
          this.syncPolling()
        }
      }
    }).catch(err => {
      debug(err, 'logout')
    })
  }

  logout() {
    let params = {
        redirect: 1,
        type: 0,
        skey: this[webProp].skey
      }
      // data加上会出错，不加data也能登出
    let data = {
      sid: this[webProp].sid,
      uin: this[webProp].uin
    }
    return this.axios({
      method: 'POST',
      url: '/webwxlogout',
      baseURL: this[webProp].baseUri,
      params: params
    }).then(res => {
      return '登出成功'
    }).catch(err => {
      debug(err)
      throw new Error('可能登出成功')
    })
  }

  start() {
    return this.checkScan().then(() => {
      this.emit('scan')
      return this.checkLogin()
    }).then(() => {
      this.emit('confirm')
      return this.login()
    }).then(() => {
      return this.init()
    }).then(() => {
      return this.notifyMobile()
    }).then(() => {
      return this.getContact()
    }).then(memberList => {
      this.emit('login', memberList)
      return this.syncPolling()
    }).catch(err => {
      this.emit('error', err)
      return Promise.reject(err)
    })
  }

  _webpushUpdate(hostUri) {
    let webpushUri = "webpush.weixin.qq.com"

    if (hostUri.indexOf("wx2.qq.com") > -1) {
      webpushUri = "webpush2.weixin.qq.com"
    } else if (hostUri.indexOf("qq.com") > -1) {
      webpushUri = "webpush.weixin.qq.com"
    } else if (hostUri.indexOf("web1.wechat.com") > -1) {
      webpushUri = "webpush1.wechat.com"
    } else if (hostUri.indexOf("web2.wechat.com") > -1) {
      webpushUri = "webpush2.wechat.com"
    } else if (hostUri.indexOf("wechat.com") > -1) {
      webpushUri = "webpush.wechat.com"
    } else if (hostUri.indexOf("web1.wechatapp.com") > -1) {
      webpushUri = "webpush1.wechatapp.com"
    } else {
      webpushUri = "webpush.wechatapp.com"
    }

    this[webProp].API_synccheck = "https://" + webpushUri + "/cgi-bin/mmwebwx-bin/synccheck"
  }

  _checkCredible(uid) {
    return this.credibleUser.has(uid)
  }

  _getUserRemarkName(uid) {
    let name = ''

    this.memberList.forEach((member) => {
      if (member['UserName'] == uid) {
        name = member['RemarkName'] ? member['RemarkName'] : member['NickName']
      }
    })

    return name
  }

  _tuning(word) {
    let params = {
      'key': '2ba083ae9f0016664dfb7ed80ba4ffa0',
      'info': word
    }
    return this.axios({
      method: 'GET',
      url: 'http://www.tuling123.com/openapi/api',
      params: params
    }).then(res => {
      const data = res.data
      if (data.code == 100000) {
        return data.text + '[微信机器人]'
      }
      return "现在思路很乱，最好联系下我哥 T_T..."
    }).catch(err => {
      debug(err)
      return "现在思路很乱，最好联系下我哥 T_T..."
    })
  }

  _msgAutoReply(msg) {
    if (this._checkCredible(msg['FromUserName'])) {
      this._tuning(msg['Content']).then((reply) => {
        this.sendMsg(reply, msg['FromUserName'])
        debug('Auto Reply ', reply)
      })
    }
  }

}