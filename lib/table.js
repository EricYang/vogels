'use strict';

var _     = require('lodash'),
    Item  = require('./item'),
    Query = require('./query'),
    Scan  = require('./scan'),
    ParallelScan = require('./parallelScan');

var internals = {};

var Table = module.exports = function (name, schema, serializer, dynamodb) {
  this.config = {name : name};
  this.schema = schema;
  this.serializer = serializer;
  this.dynamodb = dynamodb;
};

Table.prototype.initItem = function (attrs) {
  var self = this;

  if(self.itemFactory) {
    return new self.itemFactory(attrs);
  } else {
    return new Item(attrs, self);
  }
};

Table.prototype.get = function (hashKey, rangeKey, options, callback) {
  var self = this;

  if (_.isPlainObject(rangeKey) && typeof options === 'function' && !callback) {
    callback = options;
    options = rangeKey;
    rangeKey = null;
  } else if (typeof rangeKey === 'function' && !callback) {
    callback = rangeKey;
    options = {};
    rangeKey = null;
  } else if (_.isPlainObject(rangeKey) && !callback) {
    callback = options;
    options = rangeKey;
    rangeKey = null;
  } else if (typeof options === 'function' && !callback) {
    callback = options;
    options = {};
  }

  var params = {
    TableName : self.config.name,
    Key : self.serializer.buildKey(hashKey, rangeKey, self.schema)
  };

  params = _.merge({}, params, options);

  self.dynamodb.getItem(params, function (err, data) {
    if(err) {
      return callback(err);
    }

    var item = null;
    if(data.Item) {
      item = self.initItem(self.serializer.deserializeItem(self.schema, data.Item));
    }

    return callback(null, item);
  });
};

Table.prototype.create = function (item, callback) {
  var self = this;

  callback = callback || function () {};

  var data = self.schema.applyDefaults(item);
  var err = self.schema.validate(data);

  if(err) {
    return callback(err);
  }

  var params = {
    TableName : self.config.name,
    Item : self.serializer.serializeItem(self.schema, data)
  };

  self.dynamodb.putItem(params, function (err) {
    if(err) {
      return callback(err);
    }

    return callback(null, self.initItem(data));
  });
};

Table.prototype.update = function (item, options, callback) {
  var self = this;

  if (typeof options === 'function' && !callback) {
    callback = options;
    options = {};
  }

  var params = {
    TableName : self.config.name,
    Key : self.serializer.buildKey(item, null, self.schema),
    AttributeUpdates : self.serializer.serializeItemForUpdate(self.schema, 'PUT', item),
    ReturnValues : 'ALL_NEW'
  };

  if (options.expected) {
    options.Expected = self.serializer.serializeItem(self.schema, options.expected, {expected : true});

    delete options.expected;
  }

  params = _.merge({}, params, options);

  self.dynamodb.updateItem(params, function (err, data) {
    if(err) {
      return callback(err);
    }

    var item = null;
    if(data.Attributes) {
      item = self.initItem(self.serializer.deserializeItem(self.schema, data.Attributes));
    }

    return callback(null, item);
  });
};

Table.prototype.destroy = function (hashKey, rangeKey, options, callback) {
  var self = this;

  if (_.isPlainObject(rangeKey) && typeof options === 'function' && !callback) {
    callback = options;
    options = rangeKey;
    rangeKey = null;
  } else if (typeof rangeKey === 'function' && !callback) {
    callback = rangeKey;
    options = {};
    rangeKey = null;
  } else if (_.isPlainObject(rangeKey) && !callback) {
    callback = options;
    options = rangeKey;
    rangeKey = null;
  } else if (typeof options === 'function' && !callback) {
    callback = options;
    options = {};
  }

  if(!callback) {
    callback = function () {};
  }

  var params = {
    TableName : self.config.name,
    Key : self.serializer.buildKey(hashKey, rangeKey, self.schema)
  };

  if (options.expected) {
    options.Expected = self.serializer.serializeItem(self.schema, options.expected, {expected : true});

    delete options.expected;
  }

  params = _.merge({}, params, options);

  self.dynamodb.deleteItem(params, function (err, data) {
    if(err) {
      return callback(err);
    }

    var item = null;
    if(data.Attributes) {
      item = self.initItem(self.serializer.deserializeItem(self.schema, data.Attributes));
    }

    return callback(null, item);
  });
};

Table.prototype.query = function (hashKey) {
  var self = this;

  return new Query(hashKey, self, self.serializer);
};

Table.prototype.scan = function () {
  var self = this;

  return new Scan(self, self.serializer);
};

Table.prototype.parallelScan= function (totalSegments) {
  var self = this;

  return new ParallelScan(self, self.serializer, totalSegments);
};


internals.deserializeItems = function (table, callback) {
  return function (err, data) {
    if(err) {
      return callback(err);
    }

    var result = {};
    if(data.Items) {
      result.Items = _.map(data.Items, function(i) {
        return table.initItem(table.serializer.deserializeItem(table.schema, i));
      });

      delete data.Items;
    }

    if(data.LastEvaluatedKey) {
      result.LastEvaluatedKey = table.serializer.deserializeKeys(table.schema, data.LastEvaluatedKey);

      delete data.LastEvaluatedKey;
    }

    return callback(null, _.merge({}, data, result));
  };

};

Table.prototype.runQuery = function(params, callback) {
  var self = this;

  self.dynamodb.query(params, internals.deserializeItems(self, callback));
};

Table.prototype.runScan = function(params, callback) {
  var self = this;

  self.dynamodb.scan(params, internals.deserializeItems(self, callback));
};

Table.prototype.runBatchGetItems = function (params, callback) {

  var self = this;
  self.dynamodb.batchGetItem(params, callback);
};

internals.attributeDefinition = function (schema, key) {
  return {
    AttributeName : key,
    AttributeType : schema.attrs[key].dynamoType
  };
};

internals.keySchema = function (hashKey, rangeKey) {
  var result = [{
    AttributeName : hashKey,
    KeyType : 'HASH'
  }];

  if(rangeKey) {
    result.push({
      AttributeName : rangeKey,
      KeyType : 'RANGE'
    });
  }

  return result;
};

internals.secondaryIndex = function (schema, indexKey) {
  var indexName = indexKey + 'Index';

  return {
    IndexName : indexName,
    KeySchema : internals.keySchema(schema.hashKey, indexKey),
    Projection : {
      ProjectionType : 'ALL'
    }
  };
};

Table.prototype.createTable = function (options, callback) {
  var self = this;

  if (typeof options === 'function' && !callback) {
    callback = options;
    options = {};
  }
  var attributeDefinitions = [];

  attributeDefinitions.push(internals.attributeDefinition(self.schema, self.schema.hashKey));

  if(self.schema.rangeKey) {
    attributeDefinitions.push(internals.attributeDefinition(self.schema, self.schema.rangeKey));
  }

  var localSecondaryIndexes = [];

  _.forEach(self.schema.secondaryIndexes, function (key) {
    attributeDefinitions.push(internals.attributeDefinition(self.schema, key));
    localSecondaryIndexes.push(internals.secondaryIndex(self.schema, key));
  });

  var keySchema = internals.keySchema(self.schema.hashKey, self.schema.rangeKey);

  var params = {
    AttributeDefinitions : attributeDefinitions,
    TableName : self.config.name,
    KeySchema : keySchema,
    ProvisionedThroughput : {
      ReadCapacityUnits : options.readCapacity || 1,
      WriteCapacityUnits : options.writeCapacity || 1
    }
  };

  if(localSecondaryIndexes.length >= 1) {
    params.LocalSecondaryIndexes = localSecondaryIndexes;
  }

  self.dynamodb.createTable(params, callback);
};

Table.prototype.describeTable = function (callback) {

  var params = {
    TableName : this.config.name
  };

  this.dynamodb.describeTable(params, callback);
};

Table.prototype.updateTable = function (throughput, callback) {
  callback = callback || function () {};

  var params = {
    TableName : this.config.name,
    ProvisionedThroughput : {
      ReadCapacityUnits : throughput.readCapacity,
      WriteCapacityUnits : throughput.writeCapacity
    }
  };

  this.dynamodb.updateTable(params, callback);
};
