import { useState } from 'react';
import { postApi } from '../api';

export function Login() {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await postApi('/api/login', { passcode });
      window.location.href = '/';
    } catch {
      setError('That passcode didn’t match.');
    }
  };
  return (
    <form onSubmit={submit} className="card" style={{ maxWidth: 380, margin: '10vh auto' }}>
      <h1 className="headline" style={{ fontSize: 28 }}>Health</h1>
      <label className="field">Passcode
        <input type="password" autoFocus value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="current-password" />
      </label>
      {error && <p className="worse-text small" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button type="submit" className="btn primary">Unlock</button>
    </form>
  );
}
