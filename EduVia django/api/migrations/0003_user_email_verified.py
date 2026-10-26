from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0002_user_assigned_classes_user_face_hash_user_level_and_more')]

    operations = [
        migrations.AddField(
            model_name='user',
            name='email_verified',
            field=models.BooleanField(default=False),
        ),
    ]

