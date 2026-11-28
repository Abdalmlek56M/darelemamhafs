import { describe, expect, it } from 'vitest'
import {
  formatPublishError,
  getScreenShareSupport,
  HOST_MUTED_NOTICE,
  SCREEN_SHARE_INSECURE_NOTICE,
  SCREEN_SHARE_UNSUPPORTED_NOTICE,
} from './roomHelpers'

const named = (name: string, message = 'raw english message') => Object.assign(new Error(message), { name })

describe('getScreenShareSupport', () => {
  it('distinguishes insecure pages, missing API, and supported browsers', () => {
    expect(getScreenShareSupport({ secure: false, hasApi: false })).toBe('insecure')
    expect(getScreenShareSupport({ secure: false, hasApi: true })).toBe('insecure')
    expect(getScreenShareSupport({ secure: true, hasApi: false })).toBe('unsupported')
    expect(getScreenShareSupport({ secure: true, hasApi: true })).toBe('ok')
  })
})

describe('formatPublishError', () => {
  it('is silent when the user dismisses the screen picker', () => {
    expect(formatPublishError('screen', named('NotAllowedError', 'Permission denied'), false)).toBeNull()
    expect(formatPublishError('screen', named('AbortError'), false)).toBeNull()
  })

  it('never leaks raw English errors for screen share, camera, or microphone', () => {
    const notices = [
      formatPublishError('screen', named('NotReadableError', 'Could not start video source'), false),
      formatPublishError('screen', new TypeError('getDisplayMedia is not a function'), false),
      formatPublishError('camera', named('NotReadableError', 'Device in use'), false),
      formatPublishError('camera', named('NotAllowedError'), false),
      formatPublishError('microphone', named('NotFoundError'), false),
      formatPublishError('microphone', new Error('device failure'), false),
    ]
    for (const notice of notices) {
      expect(notice).toMatch(/[\u0600-\u06FF]/)
      expect(notice).not.toMatch(/Could not|Device in use|raw english|getDisplayMedia|device failure/)
    }
  })

  it('explains unsupported browsers and host mute for the microphone', () => {
    expect(formatPublishError('screen', named('NotSupportedError'), false)).toBe(SCREEN_SHARE_UNSUPPORTED_NOTICE)
    expect(formatPublishError('microphone', new Error('insufficient permissions to publish'), false)).toBe(HOST_MUTED_NOTICE)
    expect(formatPublishError('microphone', named('NotAllowedError'), true)).toBe(HOST_MUTED_NOTICE)
    expect(SCREEN_SHARE_INSECURE_NOTICE).toContain('HTTPS')
  })
})
