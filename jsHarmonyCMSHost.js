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

var jsHarmonyQueue = require('./lib/jsHarmonyQueue.js');
var Logger = require('./lib/Logger.js');
var Helper = require('./lib/Helper.js');
var WebConnect = require('./lib/WebConnect.js');
var wc = new WebConnect.WebConnect();
var path = require('path');
var os = require('os');
var fs = require('fs');
var async = require('async');
var _ = require('lodash');
var tmp = require('tmp');

var USAGE = "\r\n\
------------------------\r\n\
:::jsHarmony CMS Host:::\r\n\
------------------------\r\n\
  Usage: jsharmony-cms-host [cms_url] [target_path] [options]\r\n\
\r\n\
  cms_url       - URL to the CMS server, ex: https://instance.example.com:3000\r\n\
  target_path   - Location where CMS files will be copied.  Use \".\" for current directory\r\n\
\r\n\
  The following options are available:\r\n\
\r\n\
  --user [username]            - CMS server login username\r\n\
  --password [password]        - CMS server login password\r\n\
  --host-id [host_id]          - ID of the host, to be displayed in the CMS deployment wizard\r\n\
                                   If not specified, current machine name will be used\r\n\
  --log [log_path]             - Log messages and errors to target path\r\n\
  --delete-excess-files        - Delete excess files in target_path that are not in the publish build\r\n\
  --overwrite-all              - Always replace all local files, instead of comparing size and MD5\r\n\
  --ignore-cert-errors         - Ignore Certificate Errors (ex. for self-signed certificates)\r\n\
  --ignore-path [path]         - Ignore a file or folder:\r\n\
                                   folder/   (folder anywhere)\r\n\
                                   file.txt  (file.txt anywhere)\r\n\
                                   /folder/  (folder in root)\r\n\
                                   /file.txt (file.txt in root)\r\n\
  --download [deployment_id]   - Download an individual deployment\r\n\
";



function jsHarmonyCMSHost(){
  var _this = this;

  this.params = null;
  /*
  {
    cms_url
    target_path
    user
    password
    host_id
    log_path
    delete_excess_files: false
    overwrite_all: false
    ignore_path: []
    download_deployment
  }
  */
  
  var platform = null;

  this.connect = function(params, onConnect){
    this.params = params;

    var queue = new jsHarmonyQueue(platform, {
      login: {
        username: params.username,
        password: params.password,
      },
      jsHarmonyURL: params.cms_url,
      NetworkErrorDelay: 5000,
      login_cache_file: null,
    });
    queue.onMessage = function(msg){
      _this.deploy(queue, msg.deployment_id,
        function () { msg.returnSuccess(); },
        function (err) { msg.returnError(err); },
        function (logtype, message) { msg.log(logtype, message); },
      );
    }
    queue.start(function(){
      _this.log('Host ID: '+params.host_id);
      _this.log('CMS Host Connected');
      if(onConnect) onConnect(queue);
    });
  }

  this.ignorePath = function(fname){
    if(!fname) return false;
    if(fname[0]!='/') fname = '/' + fname;
    fname = fname.split(path.sep).join('/');
    for(var i=0;i<_this.params.ignore_path.length;i++){
      var ipath = _this.params.ignore_path[i];
      if(ipath){
        if(ipath[0]=='/'){
          if(ipath[ipath.length-1]=='/'){ //If path is folder
            if(fname.indexOf(ipath)==0) return true;
          }
          else { //If path is file
            if(fname == ipath) return true;
          }
        }
        else {
          if(ipath[ipath.length-1]=='/'){ //If path is folder
            if(fname.indexOf('/'+ipath)>=0) return true;
          }
          else { //If path is file
            if(Helper.endsWith(fname, '/'+ipath)) return true;
          }
        }
      }
    }
    return false;
  }

  this.deploy = function(queue, deployment_id, onSuccess, onFail, remoteLog){
    if(!remoteLog) remoteLog = function(logtype, message){ platform.log(message); queue.log(deployment_id, logtype, (message?message.toString():null)); }
    if(!onSuccess) onSuccess = function(){ remoteLog('info', 'CMS Deployment Host publish complete'); }
    if(!onFail) onFail = function(err){ remoteLog('error', 'CMS Deployment Host publish failed: '+err.toString()); }

    platform.log('Starting Deployment #'+deployment_id);

    remoteLog('info', 'CMS Deployment Host starting deployment');

    var existingFiles = {};
    var newFiles = {};
    var tmpfd = null;
    var tmppath = null;
    var rootPath = _this.params.target_path;
    if(rootPath[rootPath.length-1]!='/') rootPath += '/';
    var deploymentManifest = {};

    async.waterfall([

      //Get list of local dirs + files + size + hash
      function(deploy_cb){
        Helper.funcRecursive(_this.params.target_path,
          function (filepath, relativepath, file_cb) { //filefunc
            //Check if file should be ignored
            if(_this.ignorePath(relativepath)) return file_cb();
            //Generate hash
            Helper.fileHash(filepath, 'md5', function(err, hash){
              if(err) return deploy_cb('Error generating file hash for '+filepath+': '+err.toString());
              relativepath = relativepath.split(path.sep).join('/');
              existingFiles[relativepath] = hash;
              return file_cb();
            });
          },
          function (dirpath, relativepath, dir_cb) { //dirfunc
            if(_this.ignorePath(relativepath+'/')) return dir_cb(false);
            return dir_cb();
          },
          { },
          deploy_cb
        );
      },

      //Download deployment
      function(deploy_cb){
        tmp.file({ 'postfix': '.zip' }, function (err, _tmppath, _tmpfd) {
          if (err) return deploy_cb('Error Occurred While Generating Temporary Output File: '+err.toString());
          tmpfd = _tmpfd;
          tmppath = _tmppath;
          fs.close(tmpfd, function () {
            platform.log('Downloading Deployment #'+deployment_id);
            var download_params = {};
            if(!_this.params.overwrite_all) download_params.existingFiles = JSON.stringify(existingFiles);
            wc.req(_this.params.cms_url + '/_funcs/deployment_host/'+deployment_id+'/download', 'POST', download_params, queue.getHTTPHeader(), tmppath, function (err, xres, rslt) {
              if (err) return deploy_cb(err);
              else if (rslt == '---SAVEDTOFILE---') {
                platform.log('Download complete');
                return deploy_cb();
              }
              else {
                return deploy_cb('Error downloading file: ' + (rslt || ''));
              }
            }, { platform: platform });
          });
        });
      },

      //Extract zip locally
      function(deploy_cb){
        Helper.unzip(tmppath, rootPath,
          {
            onEntry: function(entry, zipFile){
              var fname = path.normalize(entry.fileName);
              if(!fname) return false;

              //Handle deployment manifest
              if(fname=='jsHarmonyCMS.deployment.manifest.json'){
                zipFile.openReadStream(entry, function(err, readStream) {
                  if(err) return platform.log.error(err);
                  var data = '';
                  readStream.on('data', function(chunk){ data += chunk.toString(); });
                  readStream.on('end', function(){
                    try{
                      deploymentManifest = JSON.parse(data);
                    }
                    catch(ex){
                      platform.log.error('Error parsing deployment manifest: '+ex.toString());
                    }
                    zipFile.readEntry();
                  });
                });
                return null;
              }

              //Check if file should be ignored
              if(_this.ignorePath(fname)) return false;

              //Extract file
              var relativepath = fname.split('\\').join('/');
              newFiles[relativepath] = true;
              platform.log('New file: '+relativepath);
              return fname;
            }
          },
          deploy_cb
        );
      },

      //If using overwrite_all, generate deleteFiles locally
      function(deploy_cb){
        if(!_this.params.delete_excess_files) return deploy_cb();
        if(!_this.params.overwrite_all) return deploy_cb();
        deploymentManifest = deploymentManifest || {};
        deploymentManifest.deleteFiles = deploymentManifest.deleteFiles||[];
        if(deploymentManifest.deleteFiles.length) return deploy_cb('Unexpected deploymentManifest deleteFiles array');

        for(var existingFile in existingFiles){
          if(!(existingFile in newFiles)){
            deploymentManifest.deleteFiles.push(existingFile);
          }
        }

        return deploy_cb();
      },

      //Delete extra files
      function(deploy_cb){
        if(!_this.params.delete_excess_files) return deploy_cb();
        if(!deploymentManifest || !deploymentManifest.deleteFiles) return deploy_cb();
        async.eachSeries(deploymentManifest.deleteFiles, function(fname, delete_cb){
          platform.log('Deleting: '+fname);
          fs.unlink(path.join(rootPath, fname), delete_cb);
        }, deploy_cb);
      },

      //Delete extra folders
      function(deploy_cb){
        if(!_this.params.delete_excess_files) return deploy_cb();
        if(!deploymentManifest || !deploymentManifest.deleteFiles) return deploy_cb();
        var deleteFolders = [];
        var deleteFoldersIdx = {};
        _.each(deploymentManifest.deleteFiles, function(fname){
          var folderName = path.dirname(fname);
          while(folderName && (folderName != '.') && !(folderName in deleteFoldersIdx)){
            deleteFolders.push(folderName);
            deleteFoldersIdx[folderName] = true; 
            folderName = path.dirname(folderName);
          }
        });
        deleteFolders.sort(function(a,b){
          var alen = a.length;
          var blen = b.length;
          if(alen < blen) return 1;
          if(alen > blen) return -1;
          return 0;
        });
        async.eachSeries(deleteFolders, function(folderName, delete_cb){
          fs.readdir(folderName, function(err, files){
            if(err) return delete_cb(err);
            if(files.length) return delete_cb();
            platform.log('Deleting: '+folderName+'/');
            fs.rmdir(folderName, delete_cb);
          });
        }, deploy_cb);
      },

      //Clean up tmp file
      function(deploy_cb){
        fs.unlink(tmppath, deploy_cb);
      },
    ], function(err){
      if(err) return onFail(err);
      return onSuccess();
    });
  }

  this.log = function(msg){
    if(platform) platform.log(msg);
    else console.log(msg);
  }

  this.cli = function(){
    process.on('SIGINT', function() {
      process.exit();
    });

    var params = null;
    try{
      var params = _this.cli_parse_params();
    }
    catch(ex){
      console.log(ex.toString());
      return;
    }
    if(!params) return _this.cli_usage();

    //Initialize platform
    platform = {
      Config: { }
    };

    if(params.ignore_cert_errors) platform.Config.ignore_cert_errors = true;
    if(params.download_deployment) platform.Config.interactive = true;

    //Initialize logging
    if(params.log_path){
      if(!path.isAbsolute(params.log_path)) params.log_path = path.join(process.cwd(), params.log_path);
      try {
        var log_path_stat = fs.lstatSync(params.log_path);
        if(log_path_stat.isDirectory()){
          if(('/\\').indexOf(params.log_path[params.log_path.length-1])<0){
            params.log_path += '/';
          }
        }
      }
      catch(ex){
        console.log('Could not access log path: '+ex.toString());
      }
      platform.Config.logdir = params.log_path;
    }
    platform.log = new Logger(platform);

    //Ignore paths
    if(!params.ignore_path) params.ignore_path = [];
    for(var i=0;i<params.ignore_path.length;i++){
      var ipath = params.ignore_path[i];
      ipath = ipath.split('\\').join('/');
      params.ignore_path[i] = ipath;
    }

    //Generate host_id if not set
    if(!params.host_id){
      params.host_id = (os.hostname()||'').toString().toUpperCase();
      params.host_id = params.host_id.replace(/[^a-zA-Z0-9\-_. ]+/g, '')||'REMOTE';
    }
    if(params.host_id.match(/[^a-zA-Z0-9\-_. ]+/)){
      console.log('Invalid Host ID: '+params.host_id);
      console.log('Please use only alphanumeric characters and - _ . in the Host ID');
      return;
    }

    //Parse CMS URL
    if(params.cms_url.indexOf('//')==0) params.cms_url = 'https:'+params.cms_url;
    if(params.cms_url.indexOf('://') < 0) params.cms_url = 'https://'+params.cms_url;

    //Validate Target Path exists
    params.target_path = path.resolve(params.target_path);
    fs.exists(params.target_path, function(exists){
      if(!exists){
        console.log('Target path does not exist');
        return;
      }
      //Start queue
      _this.connect(params, function(queue){
        if(params.download_deployment){
          _this.deploy(queue, params.download_deployment);
        }
        else {
          queue.getQueue('deployment_host_'+params.host_id);
        }
      });
    });
  }

  this.cli_parse_params = function(){
    var args = [];
    var i = 0;
    var cmd = '';
    var params = { };
  
    process.argv.forEach(function (val, index, array) {
      i++;
      if(i >= 3) args.push(val);
    });

    if(args.length < 2){ return null; }

    params.cms_url = args.shift();
    params.target_path = args.shift();

    while(args.length > 0){
      var arg = args.shift();
      if(arg=='--user'){ if(args.length === 0){ throw new Error('Missing expected argument [username]'); } params.username = args.shift(); }
      else if(arg=='--password'){ if(args.length === 0){ throw new Error('Missing expected argument [password]'); } params.password = args.shift(); }
      else if(arg=='--host-id'){ if(args.length === 0){ throw new Error('Missing expected argument [host_id]'); } params.host_id = args.shift(); }
      else if(arg=='--log'){ if(args.length === 0){ throw new Error('Missing expected argument [log_path]'); } params.log_path = args.shift(); }
      else if(arg=='--delete-excess-files'){ params.delete_excess_files = true; }
      else if(arg=='--overwrite-all'){ params.overwrite_all = true; }
      else if(arg=='--ignore-cert-errors'){ params.ignore_cert_errors = true; }
      else if(arg=='--ignore-path'){
        if(args.length === 0){ throw new Error('Missing expected argument [ignore_path]'); }
        if(!params.ignore_path) params.ignore_path = [];
        params.ignore_path.push(args.shift());
      }
      else if(arg=='--download'){ if(args.length === 0){ throw new Error('Missing expected argument [deployment_id]'); } params.download_deployment = args.shift(); }
      else throw new Error('Unexpected command line argument: '+arg);
    }
    
    return params;
  }

  this.cli_usage = function(){
    console.log(USAGE);
  }
}

(new jsHarmonyCMSHost()).cli();
