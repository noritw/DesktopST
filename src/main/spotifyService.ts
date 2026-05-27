import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { encrypt, decrypt } from './secureStore'
import type { AppSettings } from './types'

// ── PKCE helpers ──────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString('base64url').slice(0, 128)
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

// ── Auth file storage ─────────────────────────────────────

interface SpotifyAuthFile {
  accessToken: string
  refreshToken: string
  tokenExpiresAt: number
}

function getAuthFilePath(): string {
  return path.join(app.getPath('userData'), 'spotify-auth.json')
}

function readAuthFile(): SpotifyAuthFile | null {
  try {
    const p = getAuthFilePath()
    if (!fs.existsSync(p)) return null
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<SpotifyAuthFile>
    const accessToken = decrypt(raw.accessToken ?? '')
    const refreshToken = decrypt(raw.refreshToken ?? '')
    if (!accessToken || !refreshToken) return null
    return { accessToken, refreshToken, tokenExpiresAt: raw.tokenExpiresAt ?? 0 }
  } catch { return null }
}

function writeAuthFile(data: SpotifyAuthFile): void {
  fs.writeFileSync(getAuthFilePath(), JSON.stringify({
    accessToken: encrypt(data.accessToken),
    refreshToken: encrypt(data.refreshToken),
    tokenExpiresAt: data.tokenExpiresAt
  }, null, 2), 'utf-8')
}

export function clearAuthFile(): void {
  try { fs.unlinkSync(getAuthFilePath()) } catch { /* already gone */ }
}

export function isAuthenticated(): boolean {
  const auth = readAuthFile()
  return !!(auth?.accessToken && auth.refreshToken)
}

// ── OAuth PKCE flow ───────────────────────────────────────

const REDIRECT_URI = 'desktopst://spotify-callback'
const SCOPES = 'user-read-currently-playing user-read-playback-state'

let pendingVerifier: string | null = null
let pendingClientId: string | null = null

export function buildAuthUrl(clientId: string): string {
  const verifier = generateCodeVerifier()
  pendingVerifier = verifier
  pendingClientId = clientId
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: generateCodeChallenge(verifier),
    scope: SCOPES
  })
  return `https://accounts.spotify.com/authorize?${params}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

export async function handleAuthCallback(code: string): Promise<{ ok: boolean; displayName?: string; error?: string }> {
  if (!pendingVerifier || !pendingClientId) {
    return { ok: false, error: '授權請求已過期，請重新連結' }
  }
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: pendingClientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: pendingVerifier
      })
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `Spotify 授權失敗：${text}` }
    }
    const data = await res.json() as TokenResponse
    writeAuthFile({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      tokenExpiresAt: Date.now() + data.expires_in * 1000
    })
    const displayName = await fetchDisplayName(data.access_token)
    pendingVerifier = null
    pendingClientId = null
    return { ok: true, displayName: displayName ?? undefined }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

async function fetchDisplayName(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return null
    const data = await res.json() as { display_name?: string }
    return data.display_name ?? null
  } catch { return null }
}

// ── Token refresh ─────────────────────────────────────────

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000

async function refreshTokens(clientId: string, refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    })
    if (!res.ok) return false
    const data = await res.json() as TokenResponse
    const existing = readAuthFile()
    writeAuthFile({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? existing?.refreshToken ?? '',
      tokenExpiresAt: Date.now() + data.expires_in * 1000
    })
    return true
  } catch { return false }
}

async function ensureValidToken(clientId: string): Promise<string | null> {
  const auth = readAuthFile()
  if (!auth) return null
  if (Date.now() > auth.tokenExpiresAt - REFRESH_THRESHOLD_MS) {
    if (!auth.refreshToken) return null
    const ok = await refreshTokens(clientId, auth.refreshToken)
    if (!ok) return null
    return readAuthFile()?.accessToken ?? null
  }
  return auth.accessToken
}

// ── Spotify API calls ─────────────────────────────────────

interface CurrentTrack {
  id: string
  name: string
  artists: string[]
  primaryArtistId: string
  album: string
  releaseYear: string
  isPlaying: boolean
}

async function getCurrentTrack(accessToken: string): Promise<CurrentTrack | null> {
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (res.status === 204 || !res.ok) return null
    const data = await res.json() as {
      is_playing: boolean
      item?: {
        id: string
        name: string
        artists: Array<{ id: string; name: string }>
        album: { name: string; release_date: string }
      }
    }
    if (!data.item) return null
    const releaseYear = (data.item.album.release_date ?? '').slice(0, 4)
    return {
      id: data.item.id,
      name: data.item.name,
      artists: data.item.artists.map(a => a.name),
      primaryArtistId: data.item.artists[0]?.id ?? '',
      album: data.item.album.name,
      releaseYear,
      isPlaying: data.is_playing
    }
  } catch { return null }
}

async function getArtistGenres(accessToken: string, artistId: string): Promise<string[]> {
  if (!artistId) return []
  try {
    const res = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return []
    const data = await res.json() as { genres?: string[] }
    return data.genres?.slice(0, 3) ?? []
  } catch { return [] }
}

interface AudioFeatures {
  energy: number
  valence: number
  tempo: number
}

async function getAudioFeatures(accessToken: string, trackId: string): Promise<AudioFeatures | null> {
  try {
    const res = await fetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) {
      console.warn(`[Spotify] audio-features HTTP ${res.status} for ${trackId}`)
      return null
    }
    return res.json() as Promise<AudioFeatures>
  } catch { return null }
}

function describeMood(energy: number, valence: number): string {
  const e = energy > 0.65 ? 'energetic' : energy > 0.4 ? 'moderate' : 'calm'
  const v = valence > 0.65 ? 'upbeat' : valence > 0.4 ? 'neutral' : 'melancholic'
  return `${e} & ${v}`
}

// ── Public context builder ────────────────────────────────

export async function getSpotifyContextString(settings: AppSettings): Promise<string | null> {
  if (!settings.spotify?.enabled || !settings.spotify.clientId) return null
  const accessToken = await ensureValidToken(settings.spotify.clientId)
  if (!accessToken) return null
  const track = await getCurrentTrack(accessToken)
  if (!track?.isPlaying) return null

  const [features, genres] = await Promise.all([
    getAudioFeatures(accessToken, track.id),
    getArtistGenres(accessToken, track.primaryArtistId)
  ])

  const meta: string[] = []
  if (track.releaseYear) meta.push(track.releaseYear)
  if (genres.length > 0) meta.push(genres.join(', '))
  if (features) meta.push(describeMood(features.energy, features.valence))

  const metaStr = meta.length > 0 ? ` · ${meta.join(' · ')}` : ''
  return `[Spotify: Now Playing] "${track.name}" — ${track.artists.join(', ')}${metaStr}`
}
