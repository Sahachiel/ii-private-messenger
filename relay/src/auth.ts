import axios, { AxiosError } from 'axios';
import { VerifiedUser, Region } from './types';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://backend:3000';
const INTER_NODE_SECRET = process.env.INTER_NODE_SECRET ?? '';

interface VerifyTokenResponse {
  success: boolean;
  data?: {
    userId: string;
    username: string;
    region: Region;
  };
  error?: string;
}

export async function verifyClientToken(token: string): Promise<VerifiedUser> {
  try {
    const resp = await axios.post<VerifyTokenResponse>(
      `${BACKEND_URL}/api/auth/verify-token`,
      { access_token: token },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': INTER_NODE_SECRET,
        },
        timeout: 5000,
      }
    );
    if (!resp.data.success || !resp.data.data) {
      throw new Error(resp.data.error ?? 'verify_failed');
    }
    return {
      userId: resp.data.data.userId,
      username: resp.data.data.username,
      region: resp.data.data.region,
    };
  } catch (err) {
    const ax = err as AxiosError;
    throw new Error(`verify_token_failed: ${ax.message}`);
  }
}
