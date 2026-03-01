import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './user.schema';
import { KeycloakService } from '../auth/keycloak.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private keycloakService: KeycloakService,
    private emailService: EmailService,
  ) {}

  /**
   * Create a new user (registration)
   */
  async createUser(email: string, firstName: string, lastName: string): Promise<User> {
    try {
      // Create user in Keycloak
      const { userId, temporaryPassword } = await this.keycloakService.createUser(
        email,
        firstName,
        lastName,
      );

      // Create user in MongoDB
      const user = new this.userModel({
        keycloakId: userId,
        email,
        firstName,
        lastName,
        passwordChanged: false,
      });

      const savedUser = await user.save();

      // Send identification email with credentials
      await this.emailService.sendIdentificationEmail(email, userId, temporaryPassword);

      return savedUser;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to create user',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User> {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    return user;
  }

  /**
   * Get user by Keycloak ID
   */
  async getUserByKeycloakId(keycloakId: string): Promise<User> {
    const user = await this.userModel.findOne({ keycloakId });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    return user;
  }

  /**
   * Change password
   */
  async changePassword(keycloakId: string, newPassword: string): Promise<boolean> {
    try {
      const user = await this.userModel.findOne({ keycloakId });
      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Change password in Keycloak
      await this.keycloakService.changePassword(keycloakId, newPassword);

      // Update in MongoDB
      user.passwordChanged = true;
      user.lastPasswordChange = new Date();
      await user.save();

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to change password',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Reset password and send email
   */
  async resetPassword(email: string): Promise<boolean> {
    try {
      const user = await this.userModel.findOne({ email });
      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Generate reset token (in real app, store in Redis with TTL)
      const resetToken = Buffer.from(`${user.keycloakId}:${Date.now()}`).toString('base64');

      // Send password reset email
      await this.emailService.sendPasswordResetEmail(email, resetToken);

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to send password reset email',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(
    keycloakId: string,
    updateData: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      country?: string;
    },
  ): Promise<User> {
    try {
      const user = await this.userModel.findOne({ keycloakId });
      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Update in Keycloak
      await this.keycloakService.updateUserProfile(keycloakId, {
        firstName: updateData.firstName,
        lastName: updateData.lastName,
        email: updateData.email,
      });

      // Update in MongoDB
      if (updateData.firstName) user.firstName = updateData.firstName;
      if (updateData.lastName) user.lastName = updateData.lastName;
      if (updateData.email) user.email = updateData.email;

      if (updateData.phone || updateData.address || updateData.city || updateData.country) {
        if (!user.profileData) user.profileData = {};
        if (updateData.phone) user.profileData.phone = updateData.phone;
        if (updateData.address) user.profileData.address = updateData.address;
        if (updateData.city) user.profileData.city = updateData.city;
        if (updateData.country) user.profileData.country = updateData.country;
      }

      return await user.save();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to update profile',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get user profile
   */
  async getProfile(keycloakId: string): Promise<User> {
    const user = await this.userModel.findOne({ keycloakId });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }
    return user;
  }

  /**
   * Update last login
   */
  async updateLastLogin(keycloakId: string): Promise<void> {
    await this.userModel.updateOne(
      { keycloakId },
      { lastLogin: new Date() },
    );
  }
}
