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

var fs = require('fs');
var crypto = require('crypto');
var _ = require('lodash');
var async = require('async');
var path = require('path');
var yauzl = require('yauzl');
var Transform = require('stream').Transform;

exports = module.exports = {};

exports.jsonp = function (req, data) {
  return this.jsonp_raw(req, req.query.callback, JSON.stringify(data));
};
exports.jsonp_raw = function (req, id, jsparams) {
  return id+'('+jsparams+');';
};
exports.GenError = function(req,res,num,txt){
  var erslt = {'_error':{
    'Number':num,
    'Message':txt
  }
  };
  if (num == -99999) {
    erslt._error.Message = 'A system error has occurred.  If the problem continues, please contact support for assistance.';
  }
  if ('callback' in req.query) { res.end(this.jsonp(req, erslt)); return erslt; }
  if ('jsproxyid' in req) { res.end(this.js_proxy_raw(req, JSON.stringify(erslt))); return erslt; }
  res.status(500);
  res.end(JSON.stringify(erslt));
  return erslt;
};
exports.fileHash = function (fname, algo, cb){
  var sum = crypto.createHash(algo);
  var fstream = fs.createReadStream(fname);
  var haserr = false;
  fstream.on('data', function(data) { sum.update(data); });
  fstream.on('end', function(err){ if(haserr) return; return cb(null, sum.digest('hex')); });
  fstream.on('error', function(err){ if(haserr) return; haserr = true; if(err) return cb(err); });
};
exports.funcRecursive = function (fpath, filefunc /* (filepath, filerelativepath, cb) */, dirfunc /* (dirpath, dirrelativepath, cb) */, options, cb, relativepath){
  options = _.extend({
    file_before_dir: false,
    preview_dir: function(fpath, relativepath, dir_cb){ return dir_cb(); },
    sort: undefined,
  }, options||{});
  if ((fpath[fpath.length - 1] == '/') || (fpath[fpath.length - 1] == '\\')) fpath = fpath.substr(0, fpath.length - 1);
  relativepath = relativepath || '';
  fs.exists(fpath, function (exists) {
    if (!exists) return cb(null);
    fs.readdir(fpath, function (err, files) {
      if (err) return cb(err);
      var skip = false;
      async.waterfall([
        //Pre-directory operation
        function(op_cb){
          if(options.file_before_dir){
            return options.preview_dir(fpath, relativepath, function(dir_err) {
              if (dir_err===false) skip = true;
              if (dir_err) return op_cb(dir_err);
              return op_cb(null);
            });
          }
          if (!dirfunc) return op_cb(null);
          else dirfunc(fpath, relativepath, function (dir_err) {
            if (dir_err===false) skip = true;
            if (dir_err) return op_cb(dir_err);
            return op_cb(null);
          });
        },
        //File operations
        function(op_cb){
          if(skip) return op_cb(null);
          if(options.sort) files.sort(options.sort);
          async.eachSeries(files, function (file, files_cb) {
            var filepath = path.join(fpath, file);
            var filerelativepath = path.join(relativepath, file);
            fs.lstat(filepath, function (lstat_err, stats) {
              if (lstat_err) return files_cb(lstat_err);
              if (stats.isDirectory()) {
                exports.funcRecursive(filepath, filefunc, dirfunc, options, files_cb, filerelativepath);
              }
              else {
                if (!filefunc) files_cb();
                else filefunc(filepath, filerelativepath, function (file_err) {
                  if (file_err) return files_cb(file_err);
                  files_cb();
                });
              }
            });
          }, op_cb);
        },
        //Post-directory operation
        function(op_cb){
          if(skip) return op_cb(null);
          if(!options.file_before_dir) return op_cb(null);
          if (!dirfunc) return op_cb(null);
          else dirfunc(fpath, relativepath, function (dir_err) {
            if (dir_err) return op_cb(dir_err);
            return op_cb(null);
          });
        }
      ], cb);
    });
  });
};

exports.unzip = function(zipPath, dest, options, cb){
  options = _.extend({
    onEntry: null //function(entry){} //Return false == do not extract.  Return string = new path
  }, options);
  yauzl.open(zipPath, { lazyEntries: true }, function(err, zipFile){
    if(err) throw err;

    var canceled = false;
    zipFile.on('error', function(err){ canceled = true; cb(err); });
    zipFile.on('close', function(){ if(canceled) return; cb(null); });
    zipFile.on('entry', function(entry){
      if(canceled) return;

      var next = function(){ zipFile.readEntry(); };
      if(entry.fileName.indexOf('__MACOSX/') == 0) return next();

      var targetPath = entry.fileName;
      if(options.onEntry) targetPath = options.onEntry(entry, zipFile);
      if(targetPath===false) return next();
      if(targetPath===null) return;
      if((targetPath===true) || !targetPath) targetPath = entry.fileName;

      async.waterfall([
        function(entry_cb){
          if(dest){
            targetPath = path.join(dest, targetPath);
            var targetFolder = path.dirname(targetPath);
            targetFolder = path.resolve(targetFolder);

            //Check if entry has directory traversal
            var relativePath = path.relative(dest, targetFolder);
            if(_.includes(relativePath.split(path.sep), '..')) return entry_cb(new Error('Zip archive contains invalid file with directory traversal: '+entry.fileName));

            return entry_cb();
          }
          else {
            targetPath = '';
            return entry_cb();
          }
        },

        function(entry_cb){
          if(!targetPath) return entry_cb();

          //Check if entry has invalid file mode
          var fileMode = (entry.externalFileAttributes >> 16) & 0xFFFF;
          if((fileMode & 61440) == 40960) return entry_cb(new Error('Zip archive contains invalid file with symlink: '+entry.fileName));

          var isFolder = (((fileMode & 61440) == 16384) || (/\/$/.test(targetPath)));
          isFolder = isFolder || (((entry.versionMadeBy >> 8) === 0) && (entry.externalFileAttributes === 16));

          if(isFolder) {
            //Create directory
            exports.createFolderRecursive(targetPath, entry_cb);
          } else {
            //Create parent directory
            exports.createFolderRecursive(path.dirname(targetPath), function(err) {
              if (err) return entry_cb(err);
    
              zipFile.openReadStream(entry, function(err, readStream) {
                if (err) return entry_cb(err);

                //Save file contents
                var writeStream = fs.createWriteStream(targetPath);
                writeStream.on("close", function(){ return entry_cb(); });

                //Do not transform EOL, otherwise comparison with existing files will not work
                readStream.pipe(writeStream);
              });
            });
          }
        }
      ], function(err){
        if(err) throw err;
        return next();
      });
    });
    zipFile.readEntry();
  });
};

exports.createFolderRecursive = function (fpath, callback) {
  if (!callback) callback = function () { };
  if(fpath=='.') return callback();
  fpath = path.resolve(fpath);
  fs.exists(fpath, function (exists) {
    if (exists) return callback();
    exports.createFolderRecursive(path.dirname(fpath), function(err){
      if(err) return callback(err);
      fs.mkdir(fpath, '0777', function (err) {
        if (err && err.code == 'EEXIST') return callback(null);
        if (err) return callback(err);
        return callback(null);
      });
    });
  });
};

exports.eolTransform = function(){
  return new Transform({
    transform(chunk, encoding, callback) {
      var str = chunk.toString();
      var strout = '';
      var startIdx = 0;
      var chr = '';
      var prevchr = '';
      for(var i=0;i<str.length;i++){
        chr = str[i];
        if(chr=='\n'){
          if(prevchr=='\r'){
            if(global._IS_WINDOWS){ /* OK */}
            else {
              strout += str.substr(startIdx, i-startIdx-1)+'\n';
              startIdx = i+1;
            }
          }
          else {
            if(global._IS_WINDOWS){
              strout += str.substr(startIdx, i-startIdx)+'\r\n';
              startIdx = i+1;
            }
          }
        }
        prevchr = chr;
      }
      strout += str.substr(startIdx);
      callback(null, Buffer.from(strout));
    }
  });
};

exports.endsWith = function(str, suffix) {
  return str.match(suffix + "$") == suffix;
};