import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private firestore: admin.firestore.Firestore | null = null;
  private initError: string | null = null;

  onModuleInit() {
    if (!admin.apps.length) {
      try {
        // Možnosť 1: Použitie environment variable (pre produkciu)
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
        }
        // Možnosť 2: Použitie JSON súboru (pre development)
        else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
          const serviceAccountPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
          const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
        }
        // Možnosť 3: Automatické nájdenie service-account.json v backend/ adresári
        else {
          // Hľadáme v backend/ adresári (2 úrovne hore od src/firebase/)
          const serviceAccountPath = path.resolve(__dirname, '../../service-account.json');
          
          if (!fs.existsSync(serviceAccountPath)) {
            throw new Error(`File not found: ${serviceAccountPath}`);
          }
          
          const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
        }
      } catch (error: any) {
        this.initError =
          'Firebase service account not configured. ' +
          'Create service-account.json in backend/ directory or set FIREBASE_SERVICE_ACCOUNT environment variable. ' +
          `Error: ${error.message}`;
        console.error(this.initError);
      }
    }

    if (admin.apps.length) {
      this.firestore = admin.firestore();
    }
  }

  getFirestore(): admin.firestore.Firestore {
    if (!this.firestore) {
      throw new ServiceUnavailableException(
        this.initError ||
          'Firebase is not initialized. Check backend/.env and service-account.json file.',
      );
    }
    return this.firestore;
  }

  getAuth(): admin.auth.Auth {
    return admin.auth();
  }

  getStorage(): admin.storage.Storage {
    return admin.storage();
  }
}
