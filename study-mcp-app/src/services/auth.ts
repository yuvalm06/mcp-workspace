import { supabase } from '../lib/supabase';

export class AuthService {
  private static instance: AuthService;
  private currentUser: any = null;

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  async handleSignUp(email: string, password: string): Promise<void> {
    if (!supabase?.auth) {
      throw new Error('Supabase client is not initialized');
    }
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      throw new Error(error.message);
    }
  }

  async handleLogin(email: string, password: string): Promise<{ user: any; session: any } | null> {
    if (!supabase?.auth) {
      throw new Error('Supabase client is not initialized');
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('Login failed:', error);
      throw new Error(error.message);
    }
    this.currentUser = data.user;
    console.log('Login successful:', data);
    return data; // Return user and session data
  }

  async listenToAuthChanges(): Promise<void> {
    if (!supabase?.auth) {
      console.warn('Supabase client is not initialized');
      return;
    }
    supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        this.currentUser = session.user;
        console.log('User logged in:', this.currentUser);
      } else {
        this.currentUser = null;
        console.log('User logged out');
      }
    });
  }
}

export const authService = AuthService.getInstance();
