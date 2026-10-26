from django.conf import settings


class CorsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        origin = request.headers.get('Origin')
        allowed = getattr(settings, 'CORS_ALLOWED_ORIGINS', [])
        is_cloud_origin = bool(origin and (origin.endswith('.vercel.app') or origin.endswith('.onrender.com')))
        if origin and (origin in allowed or '*' in allowed or is_cloud_origin):
            response['Access-Control-Allow-Origin'] = origin
            response['Access-Control-Allow-Credentials'] = 'true'
            response['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
            response['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
            response['Vary'] = 'Origin'
        return response
