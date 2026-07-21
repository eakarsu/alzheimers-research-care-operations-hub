const PURPOSES = new Set(['care-operations', 'research-registry', 'trial-outreach', 'remote-monitoring']);
function invalid(message, status = 400) { throw Object.assign(new Error(message), { status }); }

function assertConsent(input) {
  if (!PURPOSES.has(input.purpose)) invalid('Unsupported consent purpose');
  if (!input.patientId) invalid('patientId is required');
  const validUntil = new Date(input.validUntil);
  if (!Number.isFinite(validUntil.getTime()) || validUntil <= new Date()) invalid('Consent expiration must be in the future');
  return { patientId: input.patientId, purpose: input.purpose, validUntil: validUntil.toISOString(), source: input.source || 'documented-attestation' };
}

function assertEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) invalid('At least one grounded evidence citation is required');
  evidence.forEach((item) => {
    if (!item.title || !item.uri || !item.excerpt || !/^https?:\/\//.test(item.uri)) invalid('Every evidence citation requires title, http(s) URI, and excerpt');
  });
  return evidence;
}

function assertAiDraft(input) {
  assertEvidence(input.evidence);
  if (!input.patientId || !input.intendedUse || !input.model || !input.modelVersion || !input.output) invalid('AI draft metadata is incomplete');
  if (!['low', 'medium', 'high'].includes(input.uncertainty)) invalid('uncertainty must be low, medium, or high');
  return input;
}

function assertApproval(review, principal, decision) {
  if (principal.role !== 'clinician') invalid('Licensed clinician role is required', 403);
  if (review.created_by === principal.subject) invalid('Independent clinician approval is required', 409);
  if (review.status !== 'draft') invalid('Only draft AI reviews can be decided', 409);
  if (!['approved', 'rejected'].includes(decision)) invalid('Decision must be approved or rejected');
}

function visiblePatient(principal, patientId) {
  return principal.role !== 'caregiver' || principal.patientIds.includes(patientId);
}

module.exports = { assertConsent, assertEvidence, assertAiDraft, assertApproval, visiblePatient, PURPOSES };
