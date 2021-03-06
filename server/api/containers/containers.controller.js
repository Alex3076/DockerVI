/**
 * @author gaoyangyang
 * @description
 * 容器相关的操作
 */
var      util = require('util');
var   request = require('../../components/superagent');
var     tools = require('../../components/tools');
var         Q = require('q');
var     async = require('async');
var   express = require('express');
var     mysql = require('mysql');
var    config = require('../../config/env');
var PromiseDB = require('../../components/mysql').PromiseDB;
var endpoint = require('../endpoint').SWARMADDRESS;



//格式化时间　yyyy-mm-dd
function formatTime(date, accurate){

    var    year  = date.getFullYear();
    var   month  = parseInt(date.getMonth()) + 1 < 10 ? '0' + parseInt(date.getMonth() + 1)  : parseInt(date.getMonth() + 1);
    var     day  = date.getDate() < 10 ? '0' + date.getDate() : date.getDate();
    var   hours  = date.getHours() < 10 ? '0' + date.getHours() : date.getHours();
    var minutes  = date.getMinutes() < 10 ? '0' + date.getMinutes() : date.getMinutes();
    var  second  = date.getSeconds() < 10 ? '0' + date.getSeconds() : date.getSeconds();
    if(accurate){
        return [[year, month, day].join("-"), [hours, minutes, second].join(':')].join(' ');
    }

    return [year, month, day].join("-");
}

function formatContainerState(state){
        error = state.Error;
        running = state.Running;
        if(error){
            return 'error';
        }
        return running ? 'running': 'stop';
}
function formatBindPorts(ports){
    var portList=[];
    for(var exposePort in ports){
        var bindPortList = ports[exposePort];
        var _exposePort = exposePort.split('/')[0];
        var _exposeProtocal = exposePort.split('/')[1];
        var item = {};
        if(bindPortList && bindPortList.length > 0){
            for(var index in bindPortList){
                var bindPort = bindPortList[index];
                item = {};
                item.exposePort = _exposePort;
                item.protocal = _exposeProtocal;
                item.bindHostIp = bindPort.HostIp;
                item.bindHostPort = bindPort.HostPort;
                portList.push(item);
            }
        }else{
            item = {};
            item.exposePort = _exposePort;
            item.protocal = _exposeProtocal;
            portList.push(item);
        }
    }
    // return porlist , the value that every item in list  is 'exposePort' , bindIp, bindHostPort
    return portList;
}
function formatVolumes(mounts){
    var volumesList = [];
    if(mounts.length){
        mounts.forEach(function(item, index){
            var data = {};
            data.destination = item.Destination;
            data.volumeName = item.Name;
            volumesList.push(data);
        });
    }
    return volumesList;
}
// format env define by  self
function formatEnv(env){
    var envList = [];
    for(var index in env){
        var item={};
        item.name= env[index].split('=')[0];
        item.value = env[index].split('=')[1];

        envList.push(item);
    }

    return envList;
}
// format link
function formatLinks(links){
    var linkList =[];
    if(links){
        for(var index in links){
            var item = {};
            item.server = links[index].split(':')[0].slice(1);
            item.alias = links[index].split(':')[1].slice(1);

            linkList.push(item);
        }
    }
    return linkList;
}
    // format name
function formatContainerName(name){
    name = name.slice(1); //去掉首字符'/'
    //如果不包括'/' 则直接返回容器名称
    if(name.indexOf('/') < 0){
        return name;
    }
    var names = name.split('/');
    var node = names[0];
    name = names[1];
    if(node && node[0] == '/'){
        node=node.slice(1);
    }
    if(name && name[0] == '/'){
        name=name.slice(1);
    }
    return [node, name];
}

// format APT function
function formatData(data){
    var formatData = {};
    formatData.image = data.Config.Image.split(':')[0];
    formatData.imageTag = data.Config.Image.split(':')[1] ? data.Config.Image.split(':')[1] : 'latest';
    //cmd
    formatData.cmd = data.Config.Cmd.join(' ');


    //time
    formatData.time = formatTime(new Date(data.Created));

    //networkMode
    formatData.networkMode = data.HostConfig.NetworkMode == 'default' ? 'bridge' : data.HostConfig.NetworkMode;

    // get state
    formatData.status= formatContainerState(data.State);
    if(formatData.status == 'running' && formatData.networkMode == 'bridge'){
        formatData.ip = data.NetworkSettings.Networks.bridge.IPAddress;
    }

    // get portList
    formatData.portList = formatBindPorts(data.HostConfig.PortBindings);

    // get volumeList
	formatData.volumesList = formatVolumes(data.Mounts);

    // get envList
    formatData.envList = formatEnv(data.Config.Env);

    // get linkLis
    formatData.linkList = formatLinks(data.HostConfig.Links);

    // get name  && node
    formatData.name = formatContainerName(data.Name);

    //node name
    formatData.node = data.Node.Name;

    return formatData;
}
//aysnc map中用于获取容器状态的迭代器
function getContainerStatus(data, cb){
    var id = data.Id;
    var url = endpoint + '/containers/' + id + '/json';

    request.get(url)
	.then(function(response){
			var body = response.body;
			if(!response.ok){
					cb('error', null);
			}
            try {
                delete data.Status;//删除原有的状态字段
                //获取格式化后的状态字段
                data.status = formatContainerState(body.State);
                cb(null, data);
            } catch(e){
                cb(e.message, null);
            }
	}).fail(function(err){
			cb(err.message, null);
	});

}
function operateContainer(req, res, id, action){

	var url = endpoint + '/containers/' + id;

	switch (action){
		case 'start': url = url + '/start'; break;
		case 'stop': url = url + '/stop'; break;
		default: url = url + 'restart'; break;
	}

    request.post(url)
    .then(function(response){
        if(!response.ok){
            throw new Error({ message : 'error', 'status' : response.status});
        }else{
            res.send({ msg: 'ok' });
        }
    }).fail(function(err){
        if(err.status === 304){//容器早已经在停止状态　304 – container already stopped　from https://docs.docker.com/engine/reference/api/docker_remote_api_v1.21/#start-a-container
            res.send({ msg: 'ok' });
            return;
        }
        var error_msg = err.message ? err.message : 'unknown error';
        res.send({ error_msg: error_msg, status: err.status });
    });

}

/****************接口函数××××××××××××××********/
exports.getContainerList = function(req, res){

    //只获取正在运行的容器列表　用于链接服务
    if(req.query.running && req.query.running.trim() === "true"){
        var url = endpoint + '/containers/json';
        request.get(url)
    	.then(function(response){
    			var data = response.body;
    			if(!response.ok){
    					throw new Error("error");
    			}
                //获取每个容器的镜像标签
                return data.map(function(item, index){
                    return item.Names[0].slice(1).split('/')[1];
                });
    	})
        .then(function(data){
            res.send(data);
        });
        return;
    }

	var currentPage = (parseInt(req.query.currentPage) > 0)?parseInt(req.query.currentPage) : 1;
	var itemsPerPage = (parseInt(req.query.itemsPerPage) > 0)?parseInt(req.query.itemsPerPage) : 10;

	var url = endpoint + '/containers/json?all=1';

	request.get(url)
	.then(function(response){
			var data = response.body;
			if(!response.ok){
					throw new Error("error");
			}
			//返回当前需要的数据
			data = data.slice((currentPage-1)*10, (currentPage-1)*10 + itemsPerPage);
            //获取每个容器的镜像标签
            return data.map(function(item, index){
                var tag = item.Image.split(':')[1];
                item.imageTag = tag ? tag : 'latest';
                return item;
            });
	})
    .then(function(data){
        //获取容器列表中每个容器的名字和主机名
        return data.map(function(item, index){
                    var names = formatContainerName(item.Names[0]);
                    item.node = names[0];
                    item.name = names[1];
                    return item;
               });
    })
    .then(function(data){
        //获取每个容器的运行状态
        async.map(data, getContainerStatus, function(err, results){
            if(err){
                res.status(404).send({'error_msg': err.message});
            }
            res.send(results);
        });
    }).fail(function(err){
        res.status(404).send({'error_msg': err.message});
	});
};
exports.getContainerCount = function(req, res){
	var url = endpoint + '/containers/json?all=1';

	request.get(url)
	.then(function(response){
			var _data = response.body;
			if(!response.ok){
					throw new Error("error");
			}
			res.send({count : _data.length });
	}).fail(function(err){
			res.status(404).send({'error_msg': 'error'});
	});

};
//container detail msg
exports.getContainer = function(req, res){

	var id = req.params.id;
	var url = endpoint + '/containers/' + id + '/json';
	request.get(url)
	.then(function(response){
			var _data = response.body;
			if(!response.ok){
					throw new Error({message : "error", status: response.status});
			}
            try {
                _data = formatData(_data);
    			res.send({container : _data, msg : 'success'});
            } catch (e) {
                throw new Error(e);
            }

	}).fail(function(err){
        res.send({'error_msg': err.message, 'status': err.status});
	});
};
//查看socke.js for create new container
/*
exports.createContainer = function(req, res){
    //TODO 远程拉取创建镜像会出现bug
    console.log('create');
    var data = req.body.postData;
    var url = endpoint + '/containers/create?name=' + data.Name;

    delete data.Name;
    if(tools.isNullObj(data.HostConfig.PortBindings)) delete data.HostConfig.PortBindings;
    if(tools.isNullObj(data.ExposedPorts)) delete data.ExposedPorts;

    request.post(url, data)
    .then(function(response){

        if(!response.ok){
            throw new Error({ message : 'error', 'status' : response.status});
        }else{
            console.log('ok');
            res.send({'msg': 'ok'});
        }
    }).fail(function(err){
        console.log(err);
        if('response' in err && err.response.text && /Network timed out/.test(err.response.text)){
            err.message ='网络连接超时';
        }else{
            if(err.status == 409 && /Conflict/.test(err.message)){
                //TODO bug
                err.message = '容器命名冲突或者请求时间过长(Conflict)';
            }else{
                err.message +='(未知的错误)';
            }
        }
		res.send({'error_msg': err.message, 'status': err.status});
	});
};
*/
exports.deleteContainer = function(req, res){


    var nameList = req.body.data;
    if(!nameList){
        res.send({'msg':ok});
        return;
    }
    if(util.isArray(nameList)){
        var action = 'delete';

        var _names = nameList;
        async.each(_names, function(cid, callback){
            var url = endpoint + '/containers/' + cid  + '?v=1&force=1';  //kill then remove the container also remove the volume associlated to the container

            request.del(url)
            .then(function(response){
                    if(!response.ok){
                        throw new Error({ status: response.status });
                    }
                    var index = -1;
                    index = nameList.indexOf(cid);
                    if(index >= 0) {
                        nameList.splice(index, 1);
                    }
                    callback();
            }).fail(function(err){
                    callback(err);
            });
        }, function(err){
            if(err){
                error_msg = err.message ? err.message : 'unknown error';
                res.send({ error_msg : error_msg, status : err.status, nameList: nameList });
                return ;
            }
            res.send({ msg : 'ok', nameList : nameList });
        });
    }


};
exports.updateContainer = function(req, res){
    console.log('updateContainer');

	var id = req.params.id;
	var action = req.body.action;
	operateContainer(req, res, id, action);
};
exports.getContainerStats = function(req , res){
    var id = req.params.id;
    var node = req.query.node;
    var currentTime = formatTime(new Date());
    var currentLogTbName = [node, id, currentTime].join("_").replace(/-/g, '_');
    console.log(currentLogTbName);

    //TODO　用于测试　记得删除
    // currentLogTbName = 'node5_mongo_test_2016_05_07';

    var promiseDB = new  PromiseDB();

    promiseDB.connect(function(err){
        if(err){
            res.send({error_msg : err.message, status: err.status || 500});
            promiseDB.end();
        }else{
            promiseDB.use('information_schema')
            .then(function(){
                var sql = 'SELECT count(*) FROM TABLES WHERE table_name="' + currentLogTbName + '";'
                return promiseDB.query(sql);
            }).then(function(results){
                //用于判断数据库中是否存在当然容器当天的资源数据表
                var count = results[0][0]['count(*)'];
                return count;
            }).then(function(count){
                   //当前容器当天没有对应的资源数据库表
                    if(parseInt(count) === 0){
                        res.send({isEmpty : true });
                        promiseDB.end();
                    }else{
                        return promiseDB.use(config.mysql.database);
                    }

            }).then(function(result){
                if(Object.prototype.toString.call(result) == '[object Array]' && 'serverStatus' in result[0]){
                    var sql = 'SELECT * FROM ' + currentLogTbName;
                    return promiseDB.query(sql);
                }
            }).then(function(results){
                if(results && Object.prototype.toString.call(results) == '[object Array]') {
                    var data = results[0];
                    var cpuList = [], memList = [], rxList = [], txList = [], tmList = [];
                    data.forEach(function(item, index){
                        cpuList.push(item.cpu_percent);
                        memList.push(item.mem_usage.toFixed(3));
                        rxList.push(item.rx_bytes);
                        txList.push(item.tx_bytes);
                        tmList.push(formatTime(new Date(item.read_time), true));
                    });
                    var resources = {
                        cpu : cpuList,
                        mem : memList,
                        rx  : rxList,
                        tx  : txList,
                        tm  : tmList
                    };
                    res.send(resources);
                    promiseDB.end();
                }
            }).fail(function(err){
                res.send({error_msg : err.message, status: err.status || 500});
                promiseDB.end();
            }).done();
        }
    });
};
