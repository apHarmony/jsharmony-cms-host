/*
Copyright 2021 apHarmony

This file is part of jsHarmony.

jsHarmony is free software: you can redistribute it and/or modify
it under the terms of the GNU Lesser General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

jsHarmony is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License
along with this package.  If not, see <http://www.gnu.org/licenses/>.
*/

var WebConnect = require('./WebConnect.js');
var xlib = WebConnect.xlib;
var async = require('async');
var wc = new WebConnect.WebConnect();
var fs = require('fs');
var _ = require('lodash');
var cookieParser = require('cookie');

function jsHarmonyQueue(platform, config){
  /*
  config = {
    username,
    password,
    tstmp,
    jsHarmonyURL,
    NetworkErrorDelay,
    login_cache_file,
    poll_interval,
  }
  */
  var _this = this;
  var lastPassword = null;
  var accountCookieName = null;

  _this.onMessage = null; //function(msg{id, queueid, url, filetype, returnSuccess(), returnError(err)})

  this.getHTTPHeader = function() {
    if (!config.login) config.login = { 'username': '', 'password': '', 'tstmp': '' };
    if (!config.login.username) config.login.username = '';
    if (!config.login.password) config.login.password = '';
    if (!config.login.tstmp) config.login.tstmp = '';
    var base_cookie = { username: config.login.username, password: config.login.password, remember: false, tstmp: config.login.tstmp };
    var cookie = accountCookieName+'=' + encodeURIComponent('j:' + JSON.stringify(base_cookie));
    var rslt = { 'Cookie': cookie };
    return rslt;
  }

  this.start = function (onLogin) {
    async.waterfall([
      function (cb) {
        _this.jsharmonyLogin(cb);
      },
      function (cb) {
        if(onLogin) onLogin();
        return cb();
      }
    ]);
  }

  this.jsharmonyLogin = function (onSuccess, retries) {
    if(!retries) retries = 0;
    if(retries > 1){
      return xlib.sys_error('Invalid username / password', platform);
    }
    async.waterfall([
      //Function 1: Test Existing login, if available
      function (cb) {
        var token_url = config.jsHarmonyURL + '/_token';
        wc.reqjson(token_url, 'GET', {}, _this.getHTTPHeader(), null, function (err, rslt, rsltjson, xres) {
          if (xres && (xres.statusCode == 302)) { config.login.tstmp = ''; return cb(null); }
          if (err) {
            platform.log('Error connecting to '+token_url+' :: ' + err.toString());
            setTimeout(function () { _this.jsharmonyLogin(onSuccess); }, config.NetworkErrorDelay);
            return;
          }
          return onSuccess();
        }, { platform: platform, nofollow: true });
      },
      //Function 2: Get Login Email
      function (cb) {
        if (config.login.username) {
          platform.log('User: ' + config.login.username);
          return cb(null);
        }
        config.login.username = '';
        console.log('Please enter the CMS login username:');
        xlib.getString(function (rslt) {
          config.login.username = rslt;
          if (!rslt) _this.jsharmonyLogin(onSuccess);
          else cb(null);
        });
      },
      //Function 3: Get Login Password
      function (cb) {
        if (config.login.password) { lastPassword = config.login.password; return cb(null); }
        lastPassword = '';
        console.log('\r\nPlease enter the CMS login password:');
        xlib.getPassword(function (rslt) {
          lastPassword = rslt;
          if (!rslt) _this.jsharmonyLogin(onSuccess);
          else cb(null);
        });
      },
      //Function 4: Try Login
      function (cb) {
        wc.reqjson(config.jsHarmonyURL + '/login', 'POST', { 'username': config.login.username, 'password': lastPassword, 'remember': 0, 'source': '/' }, {}, null, function (err, rslt, rsltjson, res) {
          if (err) { return xlib.sys_error(err, platform); }
          if (res && res.headers && ('set-cookie' in res.headers)) {
            var cookies = res.headers['set-cookie'];
            if (!_.isArray(cookies)) cookies = [cookies];
            for (var i = 0; i < cookies.length; i++) {
              var cookie = cookies[i];
              cookie = cookieParser.parse(cookie);
              for(var cookieName in cookie){
                if (cookieName.indexOf('account_')==0) accountCookieName = cookieName;
              }
              if(accountCookieName){
                if (cookie[accountCookieName].substr(0, 2) == 'j:') {
                  var account_cookie = JSON.parse(cookie[accountCookieName].substr(2))
                  config.login.password = account_cookie.password;
                  config.login.tstmp = account_cookie.tstmp;
                  if(!config.login_cache_file){ return cb(); }
                  fs.writeFile(config.login_cache_file, JSON.stringify(config.login), function (err) {
                    if (err) return xlib.sys_error(err, platform);
                    return cb();
                  });
                }
              }
            }
          }
          platform.log('\r\n\r\n***Invalid login***\r\n')
          _this.jsharmonyLogin(cb, retries+1);
        }, { platform: platform, nofollow: true });
      }
    ], function (err, rslt) {
      if (err) { return xlib.sys_error(err, platform); }
      if(onSuccess) return onSuccess();
    });
  };

  this.getQueue = function (queueid) {
    async.waterfall([
      function (cb) {
        platform.log('Requesting next item in queue...'+queueid);
        wc.reqjson(config.jsHarmonyURL + '/_queue/' + queueid, 'GET', {}, _this.getHTTPHeader(), null, function (err, rslt, rsltjson, xres) {
          if (xres && (xres.statusCode == 302)) return xlib.sys_error('Authentication token invalid or expired', platform);
          if (err) {
            if(err.toString()=='Timeout'){ _this.getQueue(queueid); }
            else {
              platform.log(err.toString());
              setTimeout(function () { _this.getQueue(queueid); }, config.NetworkErrorDelay);
            }
            return;
          }
          else if (rsltjson) {
            if (rsltjson._error) {
              platform.log('Error connecting to queue ' + queueid + ': ' + JSON.stringify(rsltjson._error));
              setTimeout(function () { _this.getQueue(queueid); }, config.NetworkErrorDelay);
              return;
            }
            var deployment_id = null;
            if(queueid.indexOf('deployment_host_publish_')==0){
              if (!rsltjson.deployment_id) { return _this.queueError(queueid, deployment_id, 'Queue request missing deployment_id: ' + rslt); }
              platform.log('Received Deployment #' + rsltjson.deployment_id + ' on queue ' + queueid);
            }
            else if(queueid.indexOf('deployment_host_request_')==0){
              platform.log('Received Request on queue ' + queueid);
            }
            else {
              platform.log('Unrecognized queue message: '+queueid);
            }

            deployment_id = parseInt(rsltjson.deployment_id) || null;
            
            var msg = {
              deployment_id: deployment_id,
              queueid: queueid,
              returnSuccess: function(){ _this.queueSuccess(queueid, deployment_id, 'CMS Deployment Host publish complete'); },
              returnError: function(err){ _this.queueError(queueid, deployment_id, (err?err.toString():null)); },
              log: function(logtype, message){ _this.log(deployment_id, logtype, (message?message.toString():null)); },
            }
            if(rsltjson.id) msg.id = rsltjson.id;
            if(rsltjson.body) msg.body = rsltjson.body;

            if(_this.onMessage) _this.onMessage(queueid, msg);
          }
          else {
            platform.log('Unexpected response from server');
            platform.log(rslt);
            setTimeout(function () { _this.getQueue(queueid); }, config.NetworkErrorDelay);
            return;
          }
        }, { platform: platform, nofollow: true, timeout: config.poll_interval||0 });
      }
    ]);
  }

  this.queueError = function (queueid, deployment_id, message) {
    platform.log.error(message);
    message = (message || '').toString();
    if (message.length > 500) message = message.substring(0, 500);
    _this.log(deployment_id, 'error', message, function () { _this.getQueue(queueid); });
  }

  this.queueSuccess = function (queueid, deployment_id, message) {
    message = (message || '').toString();
    _this.log(deployment_id, 'info', message, function () { _this.getQueue(queueid); });
  }

  this.log = function (deployment_id, logtype, message, callback) {
    if(!deployment_id) return callback();
    wc.reqjson(config.jsHarmonyURL + '/_funcs/deployment_host/'+deployment_id+'/log', 'POST', { logtype: logtype, message: message  }, _this.getHTTPHeader(), null, function (err, rslt, rsltjson, xres) {
      if (xres && (xres.statusCode == 302)) return xlib.sys_error('Authentication token invalid or expired', platform);
      if (err) {
        platform.log(err.toString());
        setTimeout(function () { if (callback) callback(); }, config.NetworkErrorDelay);
        return;
      }
      if (rsltjson) {
        if (rsltjson._error) { platform.log('ERROR ' + JSON.stringify(rsltjson._error)); }
      }
      if (callback) callback();
    }, { platform: platform, nofollow: true });
  };
}

exports = module.exports = jsHarmonyQueue;
