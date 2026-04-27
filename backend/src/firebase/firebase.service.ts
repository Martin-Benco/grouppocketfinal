import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private firestore!: admin.firestore.Firestore;

  onModuleInit() {
    if (!admin.apps.length) {
      // Možnosť 1: Použitie environment variable (pre produkciu)
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
        } catch (error) {
          throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT JSON format');
        }
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
        try {
          // Hľadáme v backend/ adresári (2 úrovne hore od src/firebase/)
          const serviceAccountPath = path.resolve(__dirname, '../../service-account.json');
          
          if (!fs.existsSync(serviceAccountPath)) {
            throw new Error(`File not found: ${serviceAccountPath}`);
          }
          
          const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
        } catch (error: any) {
          throw new Error(
            'Firebase service account not configured. ' +
            'Vytvorte service-account.json v backend/ adresári alebo nastavte FIREBASE_SERVICE_ACCOUNT environment variable.\n' +
            'Ako získať: https://console.firebase.google.com/project/gpv2-8a948/settings/serviceaccounts/adminsdk\n' +
            `Chyba: ${error.message}`
          );
        }
      }
    }

    this.firestore = admin.firestore();
  }

  getFirestore(): admin.firestore.Firestore {
    return this.firestore;
  }

  getAuth(): admin.auth.Auth {
    return admin.auth();
  }

  getStorage(): admin.storage.Storage {
    return admin.storage();
  }
}
