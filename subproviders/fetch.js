import fetchPonyfill from 'fetch-ponyfill';
import {inherits} from 'util';
import {asyncify, retry, waterfall} from 'async';
import JsonRpcError from 'json-rpc-error';
import promiseToCallback from 'promise-to-callback';
import createPayload from '../util/create-payload.js';
import Subprovider from './subprovider.js';
const fetch = global.fetch || fetchPonyfill().fetch

inherits(FetchSubprovider, Subprovider)

function FetchSubprovider (opts) {
  const self = this
  self.rpcUrl = opts.rpcUrl
  self.originHttpHeaderKey = opts.originHttpHeaderKey
}

FetchSubprovider.prototype.handleRequest = function (payload, next, end) {
  const self = this
  const originDomain = payload.origin

  // overwrite id to not conflict with other concurrent users
  const newPayload = createPayload(payload)
  // remove extra parameter from request
  delete newPayload.origin

  const reqParams = {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(newPayload)
  }

  if (self.originHttpHeaderKey && originDomain) {
    reqParams.headers[self.originHttpHeaderKey] = originDomain
  }

  retry({
    times: 5,
    interval: 1000,
    errorFilter: isErrorRetriable,
  },
  (cb) => self._submitRequest(reqParams, cb),
  (err, result) => {
    // ends on retriable error
    if (err && isErrorRetriable(err)) {
      const errMsg = `FetchSubprovider - cannot complete request. All retries exhausted.\nOriginal Error:\n${err.toString()}\n\n`
      const retriesExhaustedErr = new Error(errMsg)
      return end(retriesExhaustedErr)
    }
    // otherwise continue normally
    return end(err, result)
  })
}

FetchSubprovider.prototype._submitRequest = function (reqParams, cb) {
  const self = this
  const targetUrl = self.rpcUrl

  promiseToCallback(fetch(targetUrl, reqParams))((err, res) => {
    if (err) return cb(err)

    // continue parsing result
    waterfall([
      checkForHttpErrors,
      // buffer body
      (cb) => promiseToCallback(res.text())(cb),
      // parse body
      asyncify((rawBody) => JSON.parse(rawBody)),
      parseResponse
    ], cb)

    function checkForHttpErrors (cb) {
      // check for errors
      switch (res.status) {
        case 405:
          return cb(new JsonRpcError.MethodNotFound())

        case 418:
          return cb(createRatelimitError())

        case 503:
        case 504:
          return cb(createTimeoutError())

        default:
          return cb()
      }
    }

    function parseResponse (body, cb) {
      // check for error code
      if (res.status !== 200) {
        return cb(new JsonRpcError.InternalError(body))
      }
      // check for rpc error
      if (body.error) return cb(new JsonRpcError.InternalError(body.error))
      // return successful result
      cb(null, body.result)
    }
  })
}

function isErrorRetriable(err){
  const errMsg = err.toString()
  return RETRIABLE_ERRORS.some(phrase => errMsg.includes(phrase))
}

function createRatelimitError () {
  let msg = `Request is being rate limited.`
  const err = new Error(msg)
  return new JsonRpcError.InternalError(err)
}

function createTimeoutError () {
  let msg = `Gateway timeout. The request took too long to process. `
  msg += `This can happen when querying logs over too wide a block range.`
  const err = new Error(msg)
  return new JsonRpcError.InternalError(err)
}

export default FetchSubprovider
