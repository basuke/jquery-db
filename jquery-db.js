// jquery-db
// https://github.com/basuke/jquery-db

(function($) {
	
	function deferred(context, callback) {
		var dfd = $.Deferred();
		
		var dfd2 = callback.apply(context, [dfd])
		if (dfd2 && dfd2 != dfd && $.isFunction(dfd2.promise)) {
			dfd2.fail(function(err) { dfd.reject(err) });
		}
		
		return dfd.promise();
	};
	
	function error() {
		if ('error' in console) {
			console.error.apply(console, arguments);
		}
	}
	
	function log() {
		if ('log' in console) {
			console.log.apply(console, arguments);
		}
	}
	
	function insertSql(cls) {
		var sql = 'INSERT INTO ' + cls.Table + '(';
		sql += cls.Columns.join(',') + ') VALUES (';
		
		for (var i = 0; i < cls.Columns.length; ++i) {
			if (i > 0) sql += ',';
			sql += '?';
		}
		sql += ')';
		return sql;
	}
	
	function updateSql(cls) {
		var sql = 'UPDATE ' + cls.Table + ' SET ';
		for (var i = 0; i < cls.Columns.length; ++i) {
			if (i > 0) sql += ',';
			sql += cls.Columns[i] + '=?';
		}
		sql += ' WHERE ' + cls.PrimaryKey + '=?';
		return sql;
	}
	
	function deleteSql(cls) {
		var sql = 'DELETE FROM ' + cls.Table;
		sql += ' WHERE ' + cls.PrimaryKey + '=?';
		return sql;
	}
	
	var defaultDb;
	
	var Database = function(options) {
		this.name ='anonymous';
		this.version = '1.0';
		this.displayName = 'anonymous';
		this.maxSize = 1024 * 1024;
		this.log = false;
		
		if (options) {
			$.extend(this, options);
		}
		
		this.conn = openDatabase(this.name, this.version, this.displayName, this.maxSize);
	};
	
	$.extend(Database.prototype, {
		execute: function(sql, args) {
			var dfd = $.Deferred();
			
			if (this.log) $.db.log(sql, args);
			
			this.conn.transaction(function(tx) {
				if (!args) args = [];
				
				tx.executeSql(
					sql, 
					args, 
					function(tx, result) {
						dfd.resolve(tx, result);
					},
					function(tx, err) {
						$.db.error(err);
						dfd.reject(tx, err);
					}
				);
			});
			
			return dfd.promise();
		}
	});
	
	var entityClassProto = {
		PrimaryKey: 'id', 
		
		entity: function(columns) {
			return new this(columns);
		},
		
		deferred: function(callback) {
			return deferred(this, callback);
		},
		
		find: function(condition, args) {
			var sql = 'SELECT * FROM ' + this.Table;
			if (condition) {
				sql += ' ' + condition;
			}
			
			var cls = this;
			
			return deferred(this, function(dfd) {
				return this.DB.execute(sql, args).done(function(tx, result) {
					var entities = [];
					
					for (var i = 0; i < result.rows.length; ++i) {
						var e = cls.entity(result.rows.item(i));
						if (e) {
							entities.push(e);
						}
					}
					
					if (cls.DB.log) $.db.log(entities);
					
					dfd.resolve(entities);
				});
			});
		}
	};
	
	var entityInstanceProto = {
		initialize: function(columns) {
			if (columns) {
				this.update(columns);
			} else {
				var defaults = this.Class.Defaults;
				
				if ($.isFunction(defaults)) {
					defaults.apply(this, []);
				} else if ($.isPlainObject(defaults)) {
					this.update(defaults);
				}
			}
		},
		
		isEqual: function(other) {
			if (!other || this.prototype != other.prototype) return false;
			
			var pk = this.Class.PrimaryKey;
			return (this[pk] == other[pk]);
		},
		
		isSaved: function() {
			var pk = this.Class.PrimaryKey;
			return this[pk];
		},
		
		update: function(columns) {
			$.extend(this, columns);
			return this;
		},
		
		save: function() {
			var columns = this.Class.Columns;
			var pk = this.Class.PrimaryKey;
			
			var values = [];
			for (var i = 0; i < columns.length; ++i) {
				var column = columns[i];
				var value = this[column];
				switch ($.type(value)) {
					case 'null':
					case 'undefined':
						value = null;
						break;
					case 'boolean':
						value = value ? 1 : 0;
						break;
				}
				
				values.push(value);
			}
			
			var insert;
			if (this.isSaved()) {
				sql = updateSql(this.Class);
				values.push(this[pk]);
			} else {
				sql = insertSql(this.Class);
				insert = true;
			}
			
			var me = this;
			
			return deferred(this, function(dfd) {
				return this.Class.DB.execute(sql, values).done(function(tx, result) {
					if (insert) {
						me[pk] = result.insertId;
					}
					
					dfd.resolve(me);
				});
			});
		}, 
		
		destroy: function() {
			if (!this.isSaved()) {
				var dfd = $.Deferred();
				dfd.resolve(this);
				return dfd.promise();
			}
			
			var pk = this.Class.PrimaryKey;
			
			var sql = deleteSql(this.Class);
			var args = [this[pk]];
			
			var me = this;
			
			return deferred(this, function(dfd) {
				return this.Class.DB.execute(sql, args).done(function(tx, result) {
					delete me[pk];
					
					dfd.resolve(me);
				});
			});
		},
		
		deferred: function(callback) {
			return deferred(this, callback);
		}
	};
	
	var $db;
	
	$.db = {
		open: function(options) {
			if (options === undefined && defaultDb) {
				return defaultDb;
			}
			
			var db = new Database(options);
			
			if (!defaultDb) {
				defaultDb = db;
			}
			
			return db;
		},
		
		entities: {},
		
		log: log, 
		
		error: error, 
		
		pipe: function(tasks) {
			var dfd;
			$.each(tasks, function(index, task) {
				if (!dfd) {
					dfd = task();
				} else {
					dfd = dfd.pipe(task);
				}
			});
			return dfd;
		},
		
		classProto: function(tableName, columns) {
			return {
				Table: tableName, 
				Columns: columns, 
				PrimaryKey: 'id', 
				Name: null, 
				Defaults: null, 
				DB: null
			}
		},
		
		defineEntity: function(classProto, instanceProto) {
			var name = classProto.Table;
			
			if ('Name' in classProto && classProto.Name) {
				name = classProto.Name;
			}
			
			$db.entities[name] = function(columns) {
				this.initialize.apply(this, arguments);
			}
			
			var Entity = $db.entities[name];
			
			// インスタンスメソッド
			$.extend(Entity.prototype, 
				entityInstanceProto, 
				instanceProto, 
				{
					Class: Entity
				}
			);
			
			// クラスメソッド
			$.extend(Entity, 
				entityClassProto, 
				classProto, 
				{
					DB: (classProto.DB ? classProto.DB : $db.open())
				}
			);
			
			return Entity;
		}
	};
	
	$db = $.db;
	
})(jQuery);

