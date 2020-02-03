var conf = require('../conf/config');
var request = require('request');
var rp = require('request-promise');
const url = require('url');

var objectIds;
var srid;
var maxHits;

// Token holder
let token;
let scope;

var proxyUrl = 'lmsearchaddress';
var configOptions;
objectIds = [];

// Do the request in proper order
const lmSearchAddress = async (req, res) => {

  if (conf[proxyUrl]) {
    configOptions = Object.assign({}, conf[proxyUrl]);
    scope = configOptions.scope;

    // Get a token from LM
    await getTokenAsyncCall(configOptions.consumer_key, configOptions.consumer_secret, configOptions.scope);

    // Get the query parameters from the url
    const parsedUrl = url.parse(decodeURI(req.url), true);
    searchString = parsedUrl.query.q;
    if ('srid' in parsedUrl.query) {
      srid = parsedUrl.query.srid;
    } else {
       srid = '3006';
    }
    if ('maxHits' in parsedUrl.query) {
      maxHits = parsedUrl.query.maxHits;
    } else {
      maxHits = '30';
    }

    // Do a free text search to get the IDs of all that matches
    await doSearchAsyncCall(encodeURI(configOptions.url + '/referens/fritext/' + searchString + '?maxHits=' + maxHits));

    // Allow a maximum of 250 objects
    objectIds.length = objectIds.length > 250 ? 250 : objectIds.length;

    // Do a POST with all the IDs from free search to get the complete objects with geometry
    await getAddressAsyncCall(req, res);
    // Reset the array of found objects.
    objectIds = [];
  }
}

// Export the module
module.exports = lmSearchAddress;

function getTokenWait(options) {
  // Return promise to be invoked for authenticating on service requests
  return new Promise((resolve, reject) => {
      // Requesting the token service object
      request(options, (error, response, body) => {
          if (error) {
            console.log('Error token:' + error);
            reject('An error occured collecting token: ', error);
          } else {
            token = body.access_token;
            // console.log('Got token ' + token);
            resolve(body.access_token);
          }
      })
  })
}

async function getTokenAsyncCall(consumer_key, consumer_secret, scope) {
  // Request a token from Lantmateriet API
  const options = {
      url: configOptions.url_token,
      method: 'POST',
      headers: {
         'Authorization': 'Basic ' + Buffer.from(consumer_key + ':' + consumer_secret).toString('base64')
      },
      form: {
          'scope': scope,
          'grant_type': 'client_credentials'
      },
      json: true
  }
  var result = await getTokenWait(options);
  return result;
}

function doSearchWait(options) {
  return rp.get(options)
  .then(function(result) {
    var parameters = JSON.parse(result);

    parameters.forEach(function(parameter) {
      if (parameter.objektidentitet) {
        objectIds.push(parameter.objektidentitet);
      }
    });
  })
}

async function doSearchAsyncCall(searchUrl) {
  // Setup the search call and wait for result
  const options = {
      url: searchUrl,
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'scope': `${scope}`
      }
  }
  await doSearchWait(options);
}

function getAddressWait(options, res) {
  rp(options)
  .then(function (parsedBody) {
    // Send the resulting object as json and end response
    res.send(concatResult(parsedBody.features));
  })
  .catch(function (err) {
    console.log(err);
    console.log('ERROR getAddressWait!');
    res.send([{ error: 'getAddressWait' }]);
  });
}

async function getAddressAsyncCall(req, res) {
  // Setup the call for getting the objects found in search and wait for result
  var options = {
    method: 'POST',
    uri: configOptions.url + '/?includeData=total&srid=' + srid,
    body: objectIds,
    headers: {
      'content-type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'scope': `${scope}`
    },
    json: true
  };
  await getAddressWait(options, res);
}

function concatResult(features) {
  const result = [];

  features.forEach((feature) => {
    if (!feature.properties.adressomrade) {console.log(feature);}
    const objektidentitet_1 = feature.properties.objektidentitet;
    const objektidentitet_2 = feature.properties.registerenhetsreferens[0].objektidentitet;
    const kommun = feature.properties.adressomrade ? feature.properties.adressomrade.kommundel.faststalltNamn : feature.properties.gardsadressomrade.adressomrade.kommundel.faststalltNamn;
    const faststalltNamn = feature.properties.adressomrade.faststalltNamn;
    const adressplatsnummer = feature.properties.adressplatsattribut.adressplatsbeteckning.adressplatsnummer || '';
    const bokstavstillagg = feature.properties.adressplatsattribut.adressplatsbeteckning.bokstavstillagg || '';
    const postnummer = feature.properties.adressplatsattribut.postnummer;
    const postort = feature.properties.adressplatsattribut.postort;
    const koordinater = feature.properties.adressplatsattribut.adressplatspunkt.coordinates;

    result.push([objektidentitet_1, kommun + ' ' + faststalltNamn + ' ' + adressplatsnummer + bokstavstillagg + ', ' + postort, koordinater[0], koordinater[1], objektidentitet_2]);
  })

  return result;
}