import crypto from 'crypto'
import config from '../config.js'
import {
  ANNOTATION_TTL,
  LABEL_CHALLENGE,
  LABEL_EGRESS,
  LABEL_INSTANCE,
  LABEL_MANAGED_BY,
  LABEL_MANAGED_BY_VALUE,
  LABEL_POD,
  LABEL_TEAM,
} from './const.js'

export const getId = () => crypto.randomBytes(8).toString('hex')
export const getHost = (challengeId, instanceId, suffix = null) => {
  const base = `${challengeId}-${instanceId}`;
  const domain = config.challengeDomain;
  if (suffix) {
    return `${base}-${suffix}.${domain}`;
  }
  return `${base}.${domain}`;
}
export const getNamespaceName = (challengeId, teamId) =>
  `klodd-${challengeId}-${teamId}`

export const makeCommonLabels = ({ challengeId, teamId, instanceId }) => ({
  [LABEL_CHALLENGE]: challengeId,
  [LABEL_TEAM]: teamId,
  [LABEL_INSTANCE]: instanceId,
  [LABEL_MANAGED_BY]: LABEL_MANAGED_BY_VALUE,
})

export const makeNamespaceManifest = ({ name, labels, timeout }) => ({
  metadata: {
    name,
    labels,
    annotations: { [ANNOTATION_TTL]: timeout.toString() },
  },
})

export const makeNetworkPolicies = ({
  commonLabels,
  exposedPod,
  ingressSelector,
}) => [
  {
    metadata: { name: 'isolate-network' },
    spec: {
      podSelector: {},
      policyTypes: ['Ingress', 'Egress'],
      ingress: [
        {
          from: [{ namespaceSelector: { matchLabels: commonLabels } }],
        },
      ],
      egress: [
        {
          to: [{ namespaceSelector: { matchLabels: commonLabels } }],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' },
              },
            },
          ],
          ports: [
            {
              protocol: 'UDP',
              port: 53,
            },
          ],
        },
      ],
    },
  },
  {
    metadata: { name: 'allow-ingress' },
    spec: {
      podSelector: {
        matchLabels: { [LABEL_POD]: exposedPod },
      },
      policyTypes: ['Ingress'],
      ingress: [{ from: [ingressSelector] }],
    },
  },
  {
    metadata: { name: 'allow-egress' },
    spec: {
      podSelector: {
        matchLabels: { [LABEL_EGRESS]: 'true' },
      },
      policyTypes: ['Egress'],
      egress: [
        {
          to: [
            {
              ipBlock: {
                cidr: '0.0.0.0/0',
                except: ['10.0.0.0/8', '192.168.0.0/16', '172.16.0.0/20'],
              },
            },
          ],
        },
      ],
    },
  },
]

/**
 * Creates a factory function for generating Deployment manifests.
 * This version injects the external hostname as an environment variable.
 * @param {object} commonLabels - Labels to apply to all resources.
 * @param {string} host - The external hostname calculated for this instance.
 * @returns {function} A function that takes a pod config and returns a Deployment manifest.
 */
export const makeDeploymentFactory =
  (commonLabels, host) => // <-- Added 'host' parameter
  ({ name, egress, spec }) => {
    // Deep clone the spec to avoid modifying the original CRD spec object
    const podSpec = JSON.parse(JSON.stringify(spec));

    // Inject the hostname into environment variables for each container
    if (podSpec.containers && Array.isArray(podSpec.containers)) {
      podSpec.containers.forEach(container => {
        if (!container.env) {
          container.env = [];
        }
        // Add or update the EXTERNAL_HOSTNAME variable
        const envVarIndex = container.env.findIndex(env => env.name === 'EXTERNAL_HOSTNAME');
        if (envVarIndex > -1) {
          container.env[envVarIndex].value = host; // Update if exists
        } else {
          container.env.push({ name: 'EXTERNAL_HOSTNAME', value: host }); // Add if new
        }
      });
    }

    return {
      metadata: {
        name,
        labels: {
          [LABEL_POD]: name,
          ...commonLabels,
        },
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: {
            [LABEL_POD]: name,
            ...commonLabels,
          },
        },
        template: {
          metadata: {
            labels: {
              [LABEL_POD]: name,
              [LABEL_EGRESS]: (egress ?? false).toString(),
              ...commonLabels,
            },
          },
          spec: podSpec, // <-- Use the modified podSpec with the injected env var
        },
      },
    };
  }

export const makeServiceFactory =
  (commonLabels) =>
  ({ name, ports }) => ({
    metadata: {
      name,
      labels: {
        [LABEL_POD]: name,
        ...commonLabels,
      },
    },
    spec: {
      selector: {
        [LABEL_POD]: name,
        ...commonLabels,
      },
      ports: ports.map(({ port, protocol }) => ({
        name: `port-${port}`,
        protocol: protocol ?? 'TCP',
        port,
      })),
    },
  })

export const makeIngressRouteFactory =
  (kind) =>
  ({ host, serviceName, servicePort, numMiddlewares }) => ({
    apiVersion: 'traefik.io/v1alpha1',
    kind: kind === 'http' ? 'IngressRoute' : 'IngressRouteTCP',
    metadata: { name: `ingress-${host.split('.')[0]}` }, // Create unique name based on hostname
    spec: {
      entryPoints: [
        kind === 'http'
          ? config.traefik.httpEntrypoint
          : config.traefik.tcpEntrypoint,
      ],
      routes: [
        {
          kind: 'Rule',
          match: `${kind === 'http' ? 'Host' : 'HostSNI'}(\`${host}\`)`,
          middlewares: Array(numMiddlewares)
            .fill()
            .map((_, idx) => ({ name: `middleware-${idx}` })),
          services: [
            {
              kind: 'Service',
              name: serviceName,
              port: servicePort,
            },
          ],
        },
      ],
      tls: {}, // Assuming TLS is handled by Traefik entrypoint or cert-manager
    },
  })

export const makeMiddlewareFactory = (kind) => (middleware, idx) => ({
  apiVersion: 'traefik.io/v1alpha1',
  kind: kind === 'http' ? 'Middleware' : 'MiddlewareTCP',
  metadata: { name: `middleware-${idx}` },
  spec: middleware,
})
