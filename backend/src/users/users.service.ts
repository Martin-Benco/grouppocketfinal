import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private firebaseService: FirebaseService) {}

  private async buildPublicUser(uid: string, fallbackEmail?: string | null) {
    const userDoc = await this.firebaseService.getFirestore().collection('users').doc(uid).get();
    const profile = userDoc.exists ? userDoc.data() || {} : {};

    return {
      uid,
      email: (profile.email as string) || fallbackEmail || null,
      fullName: (profile.fullName as string) || null,
      profileImageUrl: (profile.profileImageUrl as string) || null,
    };
  }

  async searchUsersByEmail(query: string, requesterId: string) {
    const normalizedQuery = (query || '').trim().toLowerCase();
    if (!normalizedQuery || !normalizedQuery.includes('@') || normalizedQuery.length < 5) {
      return { users: [] };
    }

    const auth = this.firebaseService.getAuth();
    const matches = new Map<string, { uid: string; email: string | null }>();
    try {
      const userRecord = await auth.getUserByEmail(normalizedQuery);
      matches.set(userRecord.uid, {
        uid: userRecord.uid,
        email: userRecord.email || null,
      });
    } catch {
      return { users: [] };
    }

    const users = await Promise.all(
      Array.from(matches.values())
        .filter((user) => user.uid !== requesterId)
        .slice(0, 20)
        .map((user) => this.buildPublicUser(user.uid, user.email)),
    );

    return { users };
  }

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
