/* jshint asi: true, node: true, laxbreak: true, laxcomma: true, undef: true, unused: true */

var discovery   = require('homespun-discovery').observers.ssdp
  , homespun    = require('homespun-discovery')
  , inherits    = require('util').inherits
  , listener    = require('homespun-discovery').listeners.http
  , Netmask     = require('netmask').Netmask
  , pushsensor  = homespun.utilities.pushsensor
  , PushSensor  = pushsensor.Sensor
  , querystring = require('querystring')
  , roundTrip   = homespun.utilities.roundtrip
  , sensorTypes = homespun.utilities.sensortypes
  , underscore  = require('underscore')
  , url         = require('url')
  , xml2js      = require('xml2js')
  , yapi        = require('yoctolib')


var Accessory
  , Service
  , Characteristic
  , CommunityTypes
  , UUIDGen

module.exports = function (homebridge) {
  Accessory      = homebridge.platformAccessory
  Service        = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  CommunityTypes = require('hap-nodejs-community-types')(homebridge)
  UUIDGen        = homebridge.hap.uuid

  pushsensor.init(homebridge)
  homebridge.registerPlatform('homebridge-platform-yoctopuce', 'Yoctopuce', Yoctopuce, true)
}


var Yoctopuce = function (log, config, api) {
  if (!(this instanceof Yoctopuce)) return new Yoctopuce(log, config, api)

  this.log = log
  this.config = config || { platform: 'Yoctopuce' }
  this.api = api

  this.options = underscore.defaults(this.config.options || {}, { verboseP: false })

  this.parser = new xml2js.Parser()
  this.discoveries = {}
  this.hubs = {}

  discovery.init()
  listener.init()
  if (api) this.api.on('didFinishLaunching', this._didFinishLaunching.bind(this))
  else this._didFinishLaunching()
}

Yoctopuce.prototype._didFinishLaunching = function () {
  var self = this

  self.observer = new discovery.Observe({ contains: 'YoctoHub-' })
  self.observer.on('error', function (err) {
    self.log.error('discovery', err)
  }).on('up', function (options, service) {
    var params
    var hubId = service.ssdp.usn

    if (self.hubs[hubId]) {
      self.hubs[hubId].timestamp = underscore.now()
      return
    }
    self.hubs[hubId] = { timestamp: underscore.now() }

    params = url.parse(service.ssdp.location)
    service.port = params.port
    roundTrip({ location: params, logger: self.log }, underscore.extend({ rawP: true }, params),
    function (err, response, result) {
      if (err) return self.log.error('roundTrip error: ' + err.toString())

      self.parser.parseString(result, function (err, json) {
        var root = json && json.root && json.root.device && json.root.device[0]

        if (err) return self.log.error('xml2js error: ' + err.toString())

        if (root.deviceType[0] !== 'urn:yoctopuce-com:device:hub:1') return

        service.properties = { name         : root.friendlyName[0]
                             , manufacturer : root.manufacturer[0]
                             , model        : root.modelName[0]
                             , serialNumber : root.serialNumber[0]
                             }

        self.hubs[hubId].hub = new Hub(self, hubId, service)
      })
    })
  })

  setTimeout(function () {
    underscore.keys(self.discoveries).forEach(function (uuid) {
      var accessory = self.discoveries[uuid]

      self.log.warn('accessory not (yet) discovered', { UUID: uuid })
      accessory.updateReachability(false)
    })
  }.bind(self), 5 * 1000)

  self.log('didFinishLaunching')
}

Yoctopuce.prototype._addAccessory = function (sensor) {
  var self = this

  var accessory = new Accessory(sensor.name, sensor.uuid)

  accessory.on('identify', function (paired, callback) {
    self.log(accessory.displayName, ': identify request')
    callback()
  })

  if (sensor.attachAccessory.bind(sensor)(accessory)) self.api.updatePlatformAccessories([ accessory ])

  if (!self.discoveries[accessory.UUID]) {
    self.api.registerPlatformAccessories('homebridge-platform-yoctopuce', 'Yoctopuce', [ accessory ])
    self.log('addAccessory', underscore.pick(sensor,
                                             [ 'uuid', 'name', 'manufacturer', 'model', 'serialNumber', 'firmwareRevision' ]))
  }
}

Yoctopuce.prototype.configurationRequestHandler = function (context, request, callback) {/* jshint unused: false */
  this.log('configuration request', { context: context, request: request })
}

Yoctopuce.prototype.configureAccessory = function (accessory) {
  var self = this

  accessory.on('identify', function (paired, callback) {
    self.log(accessory.displayName, ': identify request')
    callback()
  })

  self.discoveries[accessory.UUID] = accessory
  self.log('configureAccessory', underscore.pick(accessory, [ 'UUID', 'displayName' ]))
}


var Hub = function (platform, hubId, service) {
  var self = this

  if (!(self instanceof Hub)) return new Hub(platform, hubId, service)

  self.platform = platform
  self.hubId = hubId
  self.rinfo = underscore.pick(service, [ 'host', 'port' ])
  self.ssdp = service.ssdp

  self.name = service.properties.name
  self.manufacturer = service.properties.manufacturer
  self.model = service.properties.model
  self.serialNumber = service.properties.serialNumber

  self.location = url.parse('http://' + self.rinfo.host + ':' + self.rinfo.port)
  self.listener = listener.singleton(platform.options)
  self.sensors = []

  self._configure(function (err) {
    if (err) return self.platform.log.error('prime', underscore.extend({ hubId: self.hubId }, err))

    self.listener.on(self.event.eventName, function (options, message) {
      var json

      try {
        json = JSON.parse(message.body)
      } catch (ex) {
        return self.platform.log.error('listener', underscore.extend({ hubId: self.hubId }, ex))
      }

      underscore.keys(json).forEach(function (key) {
        var module, properties, sensor
          , capabilities = {}
          , entry = json[key]
          , readings = {}

        if (key.indexOf('/bySerial/') !== 0) return

        module = entry.module
        sensor = self.sensors[module.serialNumber]
        underscore.keys(entry).forEach(function (name) {
          var reading = self._normalize(name, entry[name])

          if (!reading) return

          underscore.extend(readings, reading)
          if (!sensor) underscore.keys(reading).forEach(function (key) { capabilities[key] = sensorTypes[key] })
        })

        if (!sensor) {
          properties = { name             : module.logicalName || module.serialNumber
                       , manufacturer     : self.manufacturer
                       , model            : module.productName
                       , serialNumber     : module.serialNumber
                       , firmwareRevision : module.firmwareRelease
                       , hardwareRevision : module.productRelease.toString()
                       }

          sensor = new Sensor(self, module.serialNumber, { capabilities: capabilities, properties: properties })
          self.sensors[module.serialNumber] = sensor
        }

        sensor.readings = readings
        sensor._update.bind(sensor)(readings)
      })
    })

    self.platform.log('configured hub', underscore.pick(self, [ 'name', 'firmwareRevision', 'hardwareRevision' ]))
 })

  self.platform.log('discovered hub', underscore.pick(self, [ 'name', 'manufacturer', 'model', 'serialNumber' ]))
}

Hub.prototype._configure = function (callback) {
  var self = this

  roundTrip({ location: self.location, logger: self.platform.log }, { path: '/api.json' }, function (err, response, result) {
    var entries = [ { suffix: 'network/callbackMethod',
                      param : 'callbackMethod',
                      value : yapi.Y_CALLBACKMETHOD_POST
                    }
                  , { suffix: 'network/callbackEncoding',
                      param : 'callbackEncoding',
                      value : yapi.Y_CALLBACKENCODING_YOCTO_API
                    }
                  , { suffix: 'network/callbackMinDelay',
                      param : 'callbackMinDelay',
                      value :  60
                    }
                  , { suffix: 'network/callbackMaxDelay',
                      param : 'callbackMaxDelay',
                      value : 900
                    }
                  , { suffix: 'network/callbackUrl',
                      param : 'callbackUrl',
                      value : null
                    }
                  , { suffix: 'module/persistentSettings',
                      param : 'persistentSettings',
                      value :    1
                    }
                  ]

    var f = function (i) {
      var entry, location, query

      if (i >= entries.length) return callback()

      entry = entries[i++]
      switch (entry.param) {
        case 'callbackUrl':
          self.event = self.listener.addEvent('POST')
          self.event.servers.forEach(function (server) {
            var netmask = new Netmask(server.ifentry.address + '/' + server.ifentry.netmask)

            if (netmask.contains(self.rinfo.host)) location = server.location
          })
          if (!location) throw new Error('Wait. What?!? No interfaces in common with hub ', self.name)
          entry.value = location + self.event.path
          break

        case 'persistentSettings':
          break

        default:
          if (result.network[entry.param] !== entry.value) break
          return f(i)
      }

      query = {}
      query[entry.param] = entry.value
      roundTrip({ location: self.location, logger: self.platform.log },
                { path: '/api/' + entry.suffix + '?' + querystring.stringify(query), rawP: true },
                function (err, response, result) {/* jshint unused: false */
        if (err) return callback(err)

        f(i)
      })
    }

    if (err) return callback(err)

    self.firmwareRevision = result.module.firmwareRelease
    self.hardwareRevision = result.module.productRelease.toString()

    f(0)
  })
}

Hub.prototype._normalize = function (name, value) {
  var key

  if (name.indexOf('genericSensor') === 0) name = value.unit
  key = { carbonDioxide : 'co2'
        , co            : 'co'
        , humidity      : 'humidity'
        , lightSensor   : 'light'
        , no2           : 'no2'
        , pressure      : 'pressure'
        , temperature   : 'temperature'
        , voc           : 'voc'
        }[name]
  if (key) return underscore.object([ key ], [ parseFloat(value.advertisedValue) ])

  if (([ 'dataLogger', 'files', 'module', 'network', 'services' ].indexOf(name) !== -1) ||
        (name.indexOf('hubPort') === 0)) return
  this.platform.log.warn('normalize: no property for ' + name)
}


var Sensor = function (hub, sensorId, service) {
  if (!(this instanceof Sensor)) return new Sensor(hub, sensorId, service)

  PushSensor.call(this, hub.platform, sensorId, service)
}
inherits(Sensor, PushSensor);
