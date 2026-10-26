from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from .models import Resource, User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ('username', 'email', 'user_role', 'class_name', 'is_active')
    list_filter = ('user_role', 'class_name', 'is_active')
    fieldsets = DjangoUserAdmin.fieldsets + (('EduVia profile', {'fields': ('user_role', 'class_name', 'level', 'avatar', 'face_hash', 'assigned_classes', 'teaching_subjects', 'teaching_assignments', 'password_changed')}),)
    add_fieldsets = DjangoUserAdmin.add_fieldsets + (('EduVia profile', {'fields': ('email', 'user_role', 'class_name')}),)


@admin.register(Resource)
class ResourceAdmin(admin.ModelAdmin):
    list_display = ('collection', 'public_id', 'owner', 'created_at', 'updated_at')
    list_filter = ('collection',)
    search_fields = ('public_id', 'collection')
