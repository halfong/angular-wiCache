/**
* 1、资源路径不交叉
*	/users/:id 返回users数据 ok
*	/users/:id/ions 返回ions数据 error
* 2、资源数据以id为标识及索引来缓存数据
*	{id:1,name:3432,..} 或 [{id:1,name:fds,..},{id:4,name:fds,..},..]
**/
angular.module('wiCache',[])
.provider('wiCache',function(){

	var Resources = {
		'ions':{
			root:'/api/resource/ions',
			sync:'/api/ion/sync',
		},
	}

	var Config = {
		useLocalStorage : true,
		/**
		* where 映射 uri规则
		* 根据不同的后端服务修改
		* 本例RESTful接口 GET只支持
		* src/{id}
		* src/{id}/{attr}
		**/
		makePath : function(src,where,filter){
			if( !Resources[src] ){ return src; }
			var src = Resources[src].root;
			if( !where ){ return src; }
			if( !angular.isObject(where) )
				src += '/'+where;
			else if( where['id'] )
				src += '/'+where['id'];
			else if( where['iid'] )
				src += '/'+where['iid']+'/children';
			return src;
		},
		isRejection : function(data){
			if(!data || data.err){  return true; }
		}
	}

	this.set = function(ss){
		if(ss.Resources){ Resources = ss.Resources; }
		if(ss.Config){ Config = ss.Config; }
	}

	this.$get = ['$http','$q',function($http,$q){

		/**
		* 内存缓存
		* 数据变更时自动更新到localStorage
		* 以id为索引,无id键值的返回数据不会更新入库
		* cache : {
		* 	src1:{ id1:{},id2:{},.. } ,
		* 	src2:{ .. } ,
		*	fetched: [ uri , uri , ... ]
		*	, ..
		* }
		**/
		var Cache = {
			_data : {},

			/**
			* 从服务器批量更新数据
			**/
			sync : function(){
				for(var src in Resources){
					var path = Resources[src].sync;
					if(!path){ continue; }
					var self = this;
					var map = this.map(src);
					if( map.length<1 ){ continue; }
					$http.post( path,{'map':this.map(src)} ).then(function(response){
						self.save(src,response.data);
					},function(response){
						console.error('wiCache::DB '+src+'同步失败');
					});
				}
			},
			map : function(src){
				var records = this._data[src];
				var map = {};
				for( var id in records){ map[id] = records[id].sync_time; }
				console.log(map);
				return map;
			},

			/**
			* 与localStorage同步数据
			**/
			store : function(){
				if( Config.useLocalStorage ){
					window.localStorage.setItem( 'wiCache' , JSON.stringify(this._data) );
				}
			},
			mount: function(){
				if( Config.useLocalStorage && window.localStorage.getItem('wiCache') ){
					this._data = JSON.parse( window.localStorage.getItem('wiCache') );
				}
				//_data结构
				for(var src in Resources){
					if(!this._data[src]){ this._data[src] = {}; }
				}
				if(!this._data.fetched){ this._data.fetched = {}; }
			},

			/**
			* 清空缓存 | 及本地数据
			**/
			clear : function(delLS){
				this._data = {};
				if( delLS ){ window.localStorage.removeItem('wiCache'); }
				return true;
			},

			/**
			* 存入数据，id为索引
			**/
			save : function(src,data){
				var stack = null;
				if( angular.isObject(data) ){
					if( data['id'] ){ stack = [data]; }
					else{ for(var n in data){ if(data[n].id) stack = data; break; } }
				}
				if(!stack){ console.warn('wiCache::save no "id" data found! nothing saved.');return false; }

				var records = this._data[src];
				var sync_time = new Date().getTime();sync_time = Math.ceil(sync_time/1000);

				for( var i in stack){
					if(stack[i].id){
						stack[i].sync_time =sync_time;
						records[stack[i].id] = angular.merge( records[stack[i].id] ? records[stack[i].id] : {} , stack[i] ) ;
						this._data.fetched[Config.makePath(src,stack[i].id)] = sync_time;  //默认添加 path/:id 的缓存标识
					}
				}
				this._data[src] = records;
				this.store();
				return true;
			},

			/**
			* 获取数据集合
			* @return [{},{},..] || {} || null
			**/
			find : function(src,where,filter){
				where = where ? ( angular.isObject(where) ? where : {'id':where} ) : {};
				if( where.id && !filter ){  filter = 1; }
				var records =  this._data[src];
				var re = [];
				//where筛选
				for(var id in records){
					var match = true;
					for( var k in where){ if( records[id][k] != where[k] ){ match = false; break;} }
					if(match){ re.push(records[id]); }
				}
				//filter
				switch(filter){
					case 1 : return re.pop();
					default : return re;
				}
			},
		};


		if( !window.localStorage ){ Config.useLocalStorage = false; }
		Cache.mount();
		Cache.sync();
		console.log('wiCache::mounted!');

		/**
		* 外部方法
		**/
		return {

			/**
			* 绑定wiCache数据到scope
			* wiCache.load($scope,{
			* 	'Ion':[src,where,filter],	//对应 Cache.find()方法
			* })
			**/
			load : function(scope,binds,noCache){
				//加载依赖资源
				var proms = {};
				var watch_flag = {};	//避免double-bind触发两次
				for(var key in binds){
					var src = binds[key][0];
					var where = binds[key][1];
					var filter = binds[key][2];
					watch_flag[key] = false;
					watch(key,src,where,filter);
					proms[key] = this.src(src,where,filter).get(noCache);
				}
				//双向绑定 DB<->scope
				function watch(key,src,where,filter){
					scope.$watch(
			  			function(){ return Cache.find(src,where,filter); },
					    function(data){
					    	if( watch_flag[key] ){ watch_flag[key] = false;return true; }
			    			scope[key] = data;
			    			watch_flag[key] = true;
					    },
					    true
					);
					scope.$watch(key,
					    function(data){
					    	if(watch_flag[key]){ watch_flag[key] = false;return true; }
				    		Cache.save(src,data);
				    		watch_flag[key] = true;
					    },
					    true
					);
				}
				return $q.all(proms);
			},
			
			/**
			* 资源交互
			**/
			src : function(src,where,limit){
				if( !src || !Resources[src] ){ console.error('wiCache::Resource Undefined!'); return false; }
				var path = Config.makePath(src,where,limit);
				var fetched = Cache._data.fetched[path];
				var self = this;
				/**
				* 数据交互
				**/
				this._request = function(method,data){
					return $http[method]( path , data).then(function(response){
						if( Config.isRejection(response.data) ){  return $q.reject(response.data); }
						if( method=='get' ){ Cache._data.fetched[path] = true; }
						Cache.save(src,response.data);
						return response.data;
					},function(response){
						return $q.reject(response.data);
					});
				};
				this.get = function(noCache){
					if( !noCache && fetched ){ return this.resolve( Cache.find(src,where,limit) ); }
					return this._request('get');
				};
				this.post = function(data){ return this._request('post', data); };
				this.put = function(data){ return this._request('put',data); };
				this.patch = function(data){ return this._request('patch',data); };
				this.delete = function(){ return this._request('delete'); };
				return this;
			},

			/**
			* 便民方法
			**/
			http : $http ,
			resolve : function(data){
				var defer = $q.defer();
	            defer.resolve(data);
	            return defer.promise;
			},
			reject : function(data){
				return $q.reject(data);
			},
			clear : Cache.clear,
		}
	}];
});