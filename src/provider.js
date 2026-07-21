function createProvider(config, fetchImpl = fetch) {
  return {
    async fhir(request, idempotencyKey) {
      if (!config.fhirEnabled) throw Object.assign(new Error('FHIR connector is disabled'), { code: 'PROVIDER_DISABLED', retryable: false });
      const response = await fetchImpl(`${config.fhirBaseUrl.replace(/\/$/, '')}/${request.resourceType}`, {
        method: request.method || 'POST',
        headers: { authorization: `Bearer ${config.fhirToken}`, 'content-type': 'application/fhir+json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(request.resource)
      });
      if (!response.ok) throw Object.assign(new Error(`FHIR provider returned ${response.status}`), { code: `FHIR_${response.status}`, retryable: response.status === 429 || response.status >= 500 });
      return response.json();
    },
    async reserveObject(request, idempotencyKey) {
      if (!config.objectStoreEnabled) throw Object.assign(new Error('Object store connector is disabled'), { code: 'PROVIDER_DISABLED', retryable: false });
      const response = await fetchImpl(`${config.objectStoreBaseUrl.replace(/\/$/, '')}/uploads`, {
        method: 'POST', headers: { authorization: `Bearer ${config.objectStoreToken}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ ...request, bucket: config.objectStoreBucket })
      });
      if (!response.ok) throw Object.assign(new Error(`Object provider returned ${response.status}`), { code: `OBJECT_${response.status}`, retryable: response.status === 429 || response.status >= 500 });
      return response.json();
    }
  };
}

module.exports = { createProvider };
