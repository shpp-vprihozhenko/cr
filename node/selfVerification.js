"use strict";

var Promise = require('bluebird');
var env = require('node-env-file');
env(__dirname + '/.env');

const uri = `http://localhost:${process.env.SERVER_PORT}/isolated-test`;
var tests = require('./tests_examples');
var sendRequest = require('./sendRequest.js');

var config = require('./config.json');
var taskLifetime = config.userQuotes.taskLifetime * 1000;

function selfVerification () {
    return Promise.resolve(sendRequest(uri, tests[0].req))
        .then((response)=> {
    if(response.error) {
        return false;
    } else {
        return compareResponse(response.body.response);
    }
    })
    .catch(console.log.bind(console));

}


function compareResponse(body) {
    try {
        return (compareResponseArrays(body, "stdout") && compareResponseArrays(body, "stderr") &&
        compareResponseErrors(body, "dockerError") && compareResponseErrors(body, "compilerErrors") &&
        checkTimestamp(body));
    } catch (e) {
        return false;
    }
}

function compareResponseArrays(body, field) {
    var pattern = tests[0].resBody.response[field];
    body[field].forEach((res, idx)=> {
        if (res !== pattern[idx]) {
            return false;
        }
    });
    return true;
}

function compareResponseErrors(body, field) {
    if ((tests[0].resBody.response[field] && !body[field]) ||
        (!tests[0].resBody.response[field]  && body[field])) {
        return false;
    }
    return true;
}

function checkTimestamp(body) {
    body.timestamps.forEach((res, idx)=> {
        if (res > taskLifetime && (body.stderr[0].toLowerCase()).indexOf("time is out of running") == -1){
            return false;
        }
    });
    return true;
}

module.exports = selfVerification;

