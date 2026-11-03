// Unfiltered master-data responses share a cache across dashboards and forms.
// Keep filtered reports and user-scoped query families separate.
export const masterQueryKeys = {
  machines: ['machines'] as const,
  parcels: ['parcels'] as const,
};
