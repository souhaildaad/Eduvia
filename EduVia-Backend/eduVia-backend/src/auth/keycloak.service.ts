import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class KeycloakService {
  private keycloakUrl: string;
  private realm: string;
  private clientId: string;
  private clientSecret: string;
  private adminUser: string;
  private adminPassword: string;
  private accessToken: string;
  private tokenExpiry: number;

  constructor(private configService: ConfigService) {
    this.keycloakUrl = this.configService.get<string>('KEYCLOAK_URL')!;
    this.realm = this.configService.get<string>('KEYCLOAK_REALM')!;
    this.clientId = this.configService.get<string>('KEYCLOAK_CLIENT_ID')!;
    this.clientSecret = this.configService.get<string>('KEYCLOAK_CLIENT_SECRET')!;
    this.adminUser = this.configService.get<string>('KEYCLOAK_ADMIN_USER')!;
    this.adminPassword = this.configService.get<string>('KEYCLOAK_ADMIN_PASSWORD')!;
  }

  /**
   * Get admin access token for API calls
   */
  async getAdminAccessToken(): Promise<string> {
    // Check if token is still valid
    if (this.accessToken && this.tokenExpiry > Date.now()) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(
        `${this.keycloakUrl}/realms/master/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: this.adminUser,
          password: this.adminPassword,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + response.data.expires_in * 1000 - 60000; // Refresh 1 min before expiry

      return this.accessToken;
    } catch (error) {
      throw new HttpException(
        'Failed to get Keycloak admin access token',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Create a new user in Keycloak
   */
  async createUser(email: string, firstName: string, lastName: string): Promise<{ userId: string; temporaryPassword: string }> {
    try {
      const token = await this.getAdminAccessToken();
      const temporaryPassword = this.generateTemporaryPassword();

      // Create user
      const userResponse = await axios.post(
        `${this.keycloakUrl}/admin/realms/${this.realm}/users`,
        {
          email: email,
          emailVerified: false,
          firstName: firstName,
          lastName: lastName,
          enabled: true,
          username: email,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      // Extract user ID from location header
      const userId = userResponse.headers.location.split('/').pop();

      // Set temporary password
      await axios.put(
        `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/reset-password`,
        {
          type: 'PASSWORD',
          value: temporaryPassword,
          temporary: true,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return { userId, temporaryPassword };
    } catch (error) {
      if (error.response?.status === 409) {
        throw new HttpException('User already exists', HttpStatus.CONFLICT);
      }
      throw new HttpException(
        'Failed to create user in Keycloak',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Change user password
   */
  async changePassword(userId: string, newPassword: string, currentPassword?: string): Promise<boolean> {
    try {
      const token = await this.getAdminAccessToken();

      await axios.put(
        `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/reset-password`,
        {
          type: 'PASSWORD',
          value: newPassword,
          temporary: false,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return true;
    } catch (error) {
      throw new HttpException(
        'Failed to change password',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Reset password (admin-initiated)
   */
  async resetPassword(userId: string): Promise<string> {
    try {
      const token = await this.getAdminAccessToken();
      const temporaryPassword = this.generateTemporaryPassword();

      await axios.put(
        `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/reset-password`,
        {
          type: 'PASSWORD',
          value: temporaryPassword,
          temporary: true,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return temporaryPassword;
    } catch (error) {
      throw new HttpException(
        'Failed to reset password',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<any> {
    try {
      const token = await this.getAdminAccessToken();

      const response = await axios.get(
        `${this.keycloakUrl}/admin/realms/${this.realm}/users?email=${email}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.data.length === 0) {
        return null;
      }

      return response.data[0];
    } catch (error) {
      throw new HttpException(
        'Failed to get user',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<any> {
    try {
      const token = await this.getAdminAccessToken();

      const response = await axios.get(
        `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error) {
      throw new HttpException(
        'Failed to get user',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(userId: string, updateData: { firstName?: string; lastName?: string; email?: string }): Promise<boolean> {
    try {
      const token = await this.getAdminAccessToken();

      await axios.put(
        `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`,
        {
          firstName: updateData.firstName,
          lastName: updateData.lastName,
          email: updateData.email,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return true;
    } catch (error) {
      throw new HttpException(
        'Failed to update user profile',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Verify token
   */
  async verifyToken(token: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token/introspect`,
        new URLSearchParams({
          token: token,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      return response.data;
    } catch (error) {
      throw new HttpException(
        'Failed to verify token',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  /**
   * Generate a temporary password
   */
  private generateTemporaryPassword(): string {
    const length = 12;
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
  }
}
