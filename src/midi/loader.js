/**
 ----------------------------------------------------------
 MIDI.Plugin : 0.3.4 : 2015-03-26
 ----------------------------------------------------------
 https://github.com/mudcube/MIDI.js
 ----------------------------------------------------------
 Inspired by javax.sound.midi (albeit a super simple version):
 http://docs.oracle.com/javase/6/docs/api/javax/sound/midi/package-summary.html
 ----------------------------------------------------------
 Technologies
 ----------------------------------------------------------
 Web MIDI API - no native support yet (jazzplugin)
 Web Audio API - firefox 25+, chrome 10+, safari 6+, opera 15+
 HTML5 Audio Tag - ie 9+, firefox 3.5+, chrome 4+, safari 4+, opera 9.5+, ios 4+, android 2.3+
 ----------------------------------------------------------
 **/


module.exports = function() {
    window.MIDI = {};
    window.MIDI.Soundfont = {};
    'use strict';
    var audioDetect = require('./audioDetect');
    var generalMIDI = require('./gm');
    var _ = {
        merge : require('lodash.merge')
    };
    var webMidi = require('./plugin.webmidi');
    var audiotag = require('./plugin.audiotag');
    var webaudio = require('./plugin.webaudio');
    var request = require('../util/dom_request_xhr');
    var dom = require('../util/dom_request_script');

    var root = {};
    root.Player = require('./player')(root);
    root.DEBUG = true;
    root.USE_XHR = true;
    root.soundfontUrl = './soundfont/';
    root.channels = (function () { // 0 - 15 channels
        var channels = {};
        for (var i = 0; i < 16; i++) {
            channels[i] = { // default values
                instrument: 0,
                pitchBend: 0,
                mute: false,
                mono: false,
                omni: false,
                solo: false,
                volume: 1
            };
        }
        return channels;
    })();
    /*
     MIDI.loadPlugin({
     onsuccess: function() { },
     onprogress: function(state, percent) { },
     targetFormat: 'mp3', // optionally can force to use MP3 (for instance on mobile networks)
     instrument: 'acoustic_grand_piano', // or 1 (default)
     instruments: [ 'acoustic_grand_piano', 'acoustic_guitar_nylon' ] // or multiple instruments
     });
     */

    root.loadPlugin = function (opts) {
        if (typeof opts === 'function') {
            opts = {onsuccess: opts};
        }

        if(typeof opts.channels !== 'undefined'){
            for (var i = 0; i < opts.channels.length ; i++){
                root.channels[i].instrument = opts.channels[i]
            }
        }

        root.soundfontUrl = opts.soundfontUrl || root.soundfontUrl;

        /// Detect the best type of audio to use
        audioDetect(function (supports) {
            var hash = window.location.hash;
            var api = '';
            /// use the most appropriate plugin if not specified
            if (supports[opts.api]) {
                api = opts.api;
            } else if (supports[hash.substr(1)]) {
                api = hash.substr(1);
            }
            /*
             else if (supports.webmidi) {
             api = 'webmidi';
             }
             */
            else if (window.AudioContext) { // Chrome
                api = 'webaudio';

            }
            else if (window.Audio) { // Firefox
                api = 'audiotag';
            }

            /// use audio/ogg when supported
            if (opts.targetFormat) {
                var audioFormat = opts.targetFormat;
            } else { // use best quality
                var audioFormat = supports['audio/ogg'] ? 'ogg' : 'mp3';
            }

            /// load the specified plugin
            root.__api = api;
            root.__audioFormat = audioFormat;
            root.supports = supports;
            root.loadResource(opts);
        });
    };

    /*
     root.loadResource({
     onsuccess: function() { },
     onprogress: function(state, percent) { },
     instrument: 'banjo'
     })
     */

    root.loadResource = function (opts) {
        var instruments = opts.instruments || opts.instrument || 'acoustic_grand_piano';
        ///
        if (typeof instruments !== 'object') {
            if (instruments || instruments === 0) {
                instruments = [instruments];
            } else {
                instruments = [];
            }
        }

        /// convert numeric ids into strings
        for (var i = 0; i < instruments.length; i++) {
            var instrument = instruments[i];
            if (instrument === +instrument) { // is numeric
                if (generalMIDI.GM.byId[instrument]) {
                    var ins = generalMIDI.GM.byId[instrument];
                    instruments[i] = ins.id;
                    // if the instrument is a percussion add it to channel 10
                    if(ins['category'] === 'Percussive'){
                        root.channels[9].instrument = ins.number;
                    }
                }
            }
        }

        ///
        opts.format = root.__audioFormat;
        opts.instruments = instruments;
        ///
        root.midi = connect(root.__api, opts);
    };

    var connect = function(api, opts){
        switch(api) {
            case 'webmidi':
                // cant wait for this to be standardized!
                root = _.merge(root, webMidi.connect(opts, root.channels));
                break;
            case 'audiotag':
                // works ok, kinda like a drunken tuna fish, across the board
                // http://caniuse.com/audio
                requestQueue(opts, audiotag);
                break;
            case 'webaudio':
                // works awesome! safari, chrome and firefox support
                // http://caniuse.com/web-audio
                requestQueue(opts, webaudio);
                break;
        }
        root.__api = api;
    };

    var requestQueue = function (opts, context) {
        var audioFormat = opts.format;
        var instruments = opts.instruments;
        var onprogress = opts.onprogress;
        var onerror = opts.onerror;
        ///
        var length = instruments.length;
        var pending = length;
        var waitForEnd = function () {
            if (!--pending) {
                onprogress && onprogress('load', 1.0);
                root =_.merge(root, context.connect(opts, root.channels));
            }
        };
        ///
        for (var i = 0; i < length; i++) {
            var instrumentId = instruments[i];
            if (window.MIDI.Soundfont[instrumentId]) { // already loaded
                waitForEnd();
            } else { // needs to be requested
                sendRequest(instruments[i], audioFormat, function (evt, progress) {
                    var fileProgress = progress / length;
                    var queueProgress = (length - pending) / length;
                    onprogress && onprogress('load', fileProgress + queueProgress, instrumentId);
                }, function () {
                    waitForEnd();
                }, onerror);
            }
        };
    };

    var sendRequest = function (instrumentId, audioFormat, onprogress, onsuccess, onerror) {
        var soundfontPath = root.soundfontUrl + instrumentId + '-' + audioFormat + '.js';
        request({
            url: soundfontPath,
            format: 'text',
            onerror: onerror,
            onprogress: onprogress,
            onsuccess: function (event, responseText) {
                var script = document.createElement('script');
                script.language = 'javascript';
                script.type = 'text/javascript';
                script.text = responseText;
                document.body.appendChild(script);

                ///
                onsuccess();
            }
        });
    };

    root.setDefaultPlugin = function (midi) {
        for (var key in midi) {
            root[key] = midi[key];
        }
    };

    return root;
};