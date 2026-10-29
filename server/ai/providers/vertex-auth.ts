import { GoogleAuth } from 'google-auth-library';

// ADC accepts local user credentials and external-account WIF configuration.
// Constructing this boundary performs no credential discovery or network request.
export function vertexAuthentication(){
  const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
  return async():Promise<string>=>{
    const client=await auth.getClient();const result=await client.getAccessToken();
    if(!result.token||/[\r\n]/.test(result.token))throw new Error('provider_credential_unavailable');
    return result.token;
  };
}
