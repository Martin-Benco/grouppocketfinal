import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private firebaseService: FirebaseService) {}

  async getUser(userId: string, requesterId: string) {
    if (userId !== requesterId) {
      throw new ForbiddenException('Access denied');
    }

    const userDoc = await this.firebaseService.getFirestore().collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      throw new NotFoundException('User not found');
    }

    return userDoc.data();
  }

  async updateUser(userId: string, updateUserDto: UpdateUserDto, requesterId: string) {
    if (userId !== requesterId) {
      throw new ForbiddenException('Access denied');
    }

    const updateData = {
      ...updateUserDto,
      updatedAt: new Date().toISOString(),
    };

    await this.firebaseService.getFirestore().collection('users').doc(userId).set(updateData, { merge: true });
    
    return { success: true };
  }

  async updateProfileImage(userId: string, imageUrl: string, requesterId: string) {
    if (userId !== requesterId) {
      throw new ForbiddenException('Access denied');
    }

    await this.firebaseService.getFirestore().collection('users').doc(userId).set(
      { profileImageUrl: imageUrl, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    
    return { success: true, profileImageUrl: imageUrl };
  }
}
