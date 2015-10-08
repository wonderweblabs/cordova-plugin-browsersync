var path = require('path');
var fs = require('fs');
var url = require('url');

var glob = require('glob');
var et = require('elementtree');
var cheerio = require('cheerio');
var Policy = require('csp-parse');
var plist = require('plist');


var WWW_FOLDER = {
    android: 'assets/www',
    ios: 'www'
};

var CONFIG_LOCATION = {
    android: 'res/xml',
    ios: '.'
};

function parseXml(filename) {
    return new et.ElementTree(et.XML(fs.readFileSync(filename, "utf-8").replace(/^\uFEFF/, "")));
}

function Patcher(projectRoot, platforms) {
    this.projectRoot = projectRoot || '.';
    if (typeof platforms === 'string') {
        platforms = platforms.split(',');
    }
    this.platforms = platforms || ['android', 'ios'];

}

Patcher.prototype.__forEachFile = function(pattern, location, fn) {
    this.platforms.forEach(function(platform) {
        glob.sync(pattern, {
            cwd: path.join(this.projectRoot, 'platforms', platform, location[platform]),
            ignore: '*build/**'
        }).forEach(function(filename) {
            filename = path.join(this.projectRoot, 'platforms', platform, location[platform], filename);
            fn.apply(this, [filename, platform]);
        }, this);
    }, this);
};

Patcher.prototype.addCSP = function() {
    this.__forEachFile('**/index.html', WWW_FOLDER, function(filename, platform) {
        var pageContent = fs.readFileSync(filename, 'utf-8');
        var $ = cheerio.load(pageContent, {
            decodeEntities: false
        });
        var cspTag = $('meta[http-equiv=Content-Security-Policy]');
        var policy = new Policy(cspTag.attr('content'));
        policy.add('default-src', 'ws:');
        policy.add('default-src', "'unsafe-inline'");
        cspTag.attr('content', function() {
            return policy.toString();
        });
        fs.writeFileSync(filename, $.html());
        console.log('Added CSP for ', filename);
    });
};

Patcher.prototype.setStartPage = function(server) {
    return this.__forEachFile('**/config.xml', CONFIG_LOCATION, function(filename, platform) {
        var hostedPage = url.resolve(server, this.getWWWFolder(platform) + '/index.html');
        configXml = parseXml(filename);
        var contentTag = configXml.find('content[@src]');
        if (contentTag) {
            contentTag.attrib.src = hostedPage;
        }
        // Also add allow nav in case of 
        var allowNavTag = et.SubElement(configXml.find('.'), 'allow-navigation');
        allowNavTag.set('href', '*');
        fs.writeFileSync(filename, configXml.write({
            indent: 4
        }), "utf-8");
        console.log('Set start page for %s as %s', filename, hostedPage);
    });
};

Patcher.prototype.fixATS = function() {
    return this.__forEachFile('**/*Info.plist', CONFIG_LOCATION, function(filename) {
        var data = plist.parse(fs.readFileSync(filename, 'utf-8'));
        data.NSAppTransportSecurity = {
            NSAllowsArbitraryLoads: true
        };
        fs.writeFileSync(filename, plist.build(data));
        console.log('Fixed ATS in ', filename);
    });
};

Patcher.prototype.patch = function(opts) {
    opts = opts || {};
    this.setStartPage(opts.server || 'http://localhost:3000');
    this.fixATS();
    this.addCSP();
};

Patcher.prototype.getWWWFolder = function(platform) {
    return path.join('platforms', platform, WWW_FOLDER[platform]);
};

module.exports = Patcher;