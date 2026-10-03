import { demoGeocode } from '../src/lib/demoGeocoding.ts'

export default {
  fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api/demo/geocode' && import.meta.env.VITE_GOOGLE_MAPS_DEMO === 'true') {
      return demoGeocode(request, import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
    }
		return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
