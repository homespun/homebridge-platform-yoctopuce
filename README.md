# homebridge-platform-yoctopuce
A [Yoctopuce.com](https://yoctopuce.com) platform plugin for [Homebridge](https://github.com/nfarina/homebridge).

# Installation
Run these commands:

    % sudo npm install -g homebridge
    % sudo npm install -g homebridge-platform-yoctopuce

On Linux, you might see this output for the second command:

    npm ERR! pcap2@3.0.4 install: node-gyp rebuild
    npm ERR! Exit status 1
    npm ERR!

If so, please try

    % apt-get install libpcap-dev

and try

    % sudo npm install -g homebridge-platform-yoctopuce

again!

NB: If you install homebridge like this:

    sudo npm install -g --unsafe-perm homebridge

Then all subsequent installations must be like this:

    sudo npm install -g --unsafe-perm homebridge-platform-yoctopuce

# Configuration
If you're already running `homebridge` on your system,
then you already have a `~/.homebridge/config.json` file and no configuration is needed!

This is a "dynamic" platform plugin,
so it will automatically look for Yoctopuce Hubs on the local network that respond to SSDP discovery requests.

If this is your first time with `homebridge`,
this will suffice:

    { "bridge"       :
      { "name"       : "Homebridge"
      , "username"   : "CC:22:3D:E3:CE:30"
      , "port"       : 51826
      , "pin"        : "031-45-154"
      }
    , "description"  : ""
    , "accessories"  :
      [
      ]
    , "platforms"    :
      [
        { "platform" : "homebridge-platform-yoctopuce"
        , "name"     : "Yoctopuce"
        }
      ]
    }

# Supported Sensors

* Yocto-CO2
* Yocto-Light-V3
* Yocto-Meteo
* Yocto-4-20mA-Rx (for CO and NO2)

If you add others,
please submit a pull request.
