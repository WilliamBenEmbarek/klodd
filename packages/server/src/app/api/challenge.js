import challengeResources from '../../k8s/resource.js'
import {
  getInstance,
  createInstance,
  deleteInstance,
} from '../../k8s/instance.js'
import { InstanceCreationError, InstanceExistsError } from '../../error.js'

const routes = async (fastify, _options) => {
  fastify.addHook('preHandler', async (req, res) => {
    if (!challengeResources.has(req.params.challengeId)) {
      res.notFound('Challenge does not exist')
    }
  })
  fastify.addHook('preHandler', fastify.authenticate)

  fastify.route({
    method: 'GET',
    url: '/:challengeId',
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: {
              type: 'string',
              enum: ['Stopped', 'Stopping', 'Unknown', 'Running', 'Starting'],
            },
            timeout: { type: 'integer' },
            server: {
              type: 'object',
              properties: {
                kind: { type: 'string' },
                host: { type: 'string' },
                port: { type: 'integer' },
              },
              required: ['kind', 'host'],
            },
            additionalServers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string' },
                  host: { type: 'string' },
                  port: { type: 'integer' },
                  }
              },
              required: ['kind', 'host']
            },
            time: {
              type: 'object',
              properties: {
                start: { type: 'integer' },
                stop: { type: 'integer' },
                remaining: { type: 'integer' },
              },
              required: ['start', 'stop', 'remaining'],
            },
          },
          required: ['name', 'status', 'timeout'],
        },
      },
    },
    handler: async (req, _res) => {
      const { challengeId } = req.params
      const teamId = req.user.sub
      const instanceData = await getInstance(challengeId, teamId);

      // Check if servers array exists
      const { servers, ...restData } = instanceData;

      // Only process servers if they exist
      let mainServer = undefined;
      let additionalServers = undefined;

      if (servers && servers.length > 0) {
        // The first server is the main/primary server
        mainServer = servers[0];

        // Any additional servers (if they exist)
        if (servers.length > 1) {
          additionalServers = servers.slice(1);
        }
      }

      // Return data in the format expected by the client
      return {
        ...restData,
        server: mainServer,
        additionalServers: additionalServers
      };
    },
  })

  fastify.route({
    method: 'POST',
    url: '/:challengeId/create',
    schema: {
      body: {
        type: 'object',
        properties: {
          recaptcha: { type: 'string' },
        },
        required: ['recaptcha'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { const: 'Starting' },
            timeout: { type: 'integer' },
            server: {
              type: 'object',
              properties: {
                kind: { type: 'string' },
                host: { type: 'string' },
                port: { type: 'integer' },
              },
              required: ['kind', 'host'],
            },
            additionalServers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string' },
                  host: { type: 'string' },
                  port: { type: 'integer' },
                  name: { type: 'string' }
                },
                required: ['kind', 'host']
              }
            },
          },
          required: ['name', 'status', 'timeout', 'server'],
        },
      },
    },
    preHandler: [fastify.recaptcha],
    handler: async (req, res) => {
      const { challengeId } = req.params
      const teamId = req.user.sub
    
      try {
        const instance = await createInstance(challengeId, teamId, req.log)
        req.log.info('instance created')
    
        // Extract the servers array with defensive checks
        const { servers, ...restData } = instance;
    
        // Only process servers if they exist
        let mainServer = undefined;
        let additionalServers = undefined;
    
        if (servers && servers.length > 0) {
          // The first server is the main/primary server
          mainServer = servers[0];
    
          // Any additional servers (if they exist)
          if (servers.length > 1) {
            additionalServers = servers.slice(1);
          }
        }
    
        // Return data in the format expected by the client
        return {
          ...restData,
          server: mainServer,
          additionalServers: additionalServers
        };
      } catch (err) {
        // Error handling remains unchanged
        if (err instanceof InstanceExistsError) {
          req.log.debug(err)
          req.log.debug(err.cause)
          return res.conflict(err.message)
        }
        if (err instanceof InstanceCreationError) {
          req.log.error(err)
          req.log.error(err.cause)
          return res.conflict(err.message)
        }
        throw err
      }
    },
  })

  fastify.route({
    method: 'POST',
    url: '/:challengeId/delete',
    schema: {
      body: {
        type: 'object',
        properties: {
          recaptcha: { type: 'string' },
        },
        required: ['recaptcha'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { const: 'Stopping' },
            timeout: { type: 'integer' },
          },
          required: ['name', 'status', 'timeout'],
        },
      },
    },
    preHandler: [fastify.recaptcha],
    handler: async (req, _res) => {
      const { challengeId } = req.params
      const teamId = req.user.sub
      const instance = await deleteInstance(challengeId, teamId, req.log)
      req.log.info('instance deleted')
      return instance
    },
  })
}

export default routes
