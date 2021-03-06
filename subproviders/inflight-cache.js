import {cacheIdentifierForPayload} from '../util/rpc-cache-utils.js';
import Subprovider from './subprovider.js';

class InflightCacheSubprovider extends Subprovider {

  constructor (opts) {
    super()
    this.inflightRequests = {}
  }

  addEngine (engine) {
    this.engine = engine
  }

  handleRequest (req, next, end) {
    const cacheId = cacheIdentifierForPayload(req, { includeBlockRef: true })

    // if not cacheable, skip
    if (!cacheId) return next()

    // check for matching requests
    let activeRequestHandlers = this.inflightRequests[cacheId]

    if (!activeRequestHandlers) {
      // create inflight cache for cacheId
      activeRequestHandlers = []
      this.inflightRequests[cacheId] = activeRequestHandlers

      next((err, result, cb) => {
        // complete inflight for cacheId
        delete this.inflightRequests[cacheId]
        activeRequestHandlers.forEach((handler) => handler(err, result))
        cb(err, result)
      })

    } else {
      // hit inflight cache for cacheId
      // setup the response listener
      activeRequestHandlers.push(end)
    }

  }
}

export default InflightCacheSubprovider;
