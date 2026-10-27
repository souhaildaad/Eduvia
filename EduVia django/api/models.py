from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    email = models.EmailField(unique=True)
    user_role = models.CharField(max_length=20, default='student')
    class_name = models.CharField(max_length=120, blank=True)
    avatar = models.TextField(blank=True)
    face_hash = models.TextField(blank=True)
    assigned_classes = models.JSONField(default=list, blank=True)
    teaching_subjects = models.JSONField(default=list, blank=True)
    teaching_assignments = models.JSONField(default=list, blank=True)
    level = models.CharField(max_length=40, blank=True)
    password_changed = models.BooleanField(default=False)
    email_verified = models.BooleanField(default=False)
    keycloak_id = models.CharField(max_length=120, blank=True)
    first_login_at = models.DateTimeField(null=True, blank=True)
    last_password_change = models.DateTimeField(null=True, blank=True)
    password_synced_at = models.DateTimeField(null=True, blank=True)
    legacy_updated_at = models.DateTimeField(null=True, blank=True)

    def save(self, *args, **kwargs):
        if self.is_superuser:
            self.user_role = 'admin'
        super().save(*args, **kwargs)


class Resource(models.Model):
    """JSON-backed records used by EduVia's feature APIs."""
    collection = models.CharField(max_length=120, db_index=True)
    public_id = models.CharField(max_length=120, db_index=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                               on_delete=models.CASCADE, related_name='api_resources')
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['collection', 'public_id'], name='unique_resource_id_per_collection')]
        ordering = ['-created_at']
