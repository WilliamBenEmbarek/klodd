import classnames from 'classnames'
import produce from 'immer'
import { useContext, useRef } from 'react'
import ReCAPTCHA from 'react-google-recaptcha'
import { useParams } from 'react-router-dom'
import { toast } from 'react-toastify'

import TimeAgo from 'react-time-ago'

import AuthButton from '../components/authbutton'
import Button from '../components/button'
import Server from '../components/server'
import Spinner from '../components/spinner'
import config from '../config'

import './challenge.css'

import { apiRequest, useChallenge } from '../api'
import { ColorThemeContext } from '../components/colortheme'

const Challenge = () => {
  const { challengeId } = useParams()
  const { data, error, mutate } = useChallenge(challengeId)
  const recaptchaRef = useRef(null)
  const theme = useContext(ColorThemeContext)

  const handleAuth = (token) => {
    localStorage.setItem('token', token)
    mutate()
  }

  const execRecaptcha = async () => {
    const resetParams = {
      isLoading: null,
      autoClose: null,
      closeOnClick: null,
      closeButton: null,
      draggable: null,
      delay: 100,
    }
    let toastId = null
    const showToast = setTimeout(() => {
      toastId = toast.loading('Waiting for reCAPTCHA', {
        toastId: 'recaptcha-loading',
      })
    }, 1000)

    let token = undefined
    try {
      token = await recaptchaRef.current.executeAsync()
      if (toastId) {
        toast.dismiss(toastId)
      }
    } catch (err) {
      const msg = err?.message ?? 'reCAPTCHA failed'
      if (toastId) {
        toast.update(toastId, {
          ...resetParams,
          type: 'error',
          render: msg,
        })
      } else {
        toast.error(msg)
      }
    }
    clearTimeout(showToast)
    recaptchaRef.current.reset()
    return token
  }

  const handleStart = async () => {
    const recaptcha = await execRecaptcha()
    if (recaptcha === undefined) {
      return
    }

    const promise = toast.promise(
      apiRequest('POST', `/api/challenge/${challengeId}/create`, {
        recaptcha,
      }),
      {
        pending: 'Starting instance',
        success: 'Instance starting',
        error: {
          render({ data }) {
            return data?.message ?? 'Could not start instance'
          },
        },
      }
    )
    mutate(promise, {
      optimisticData: produce(data, (draft) => {
        draft.status = 'Starting'
      }),
      rollbackOnError: true,
      revalidate: true,
      populateCache: true,
    }).catch(() => {})
  }

  const handleStop = async () => {
    const recaptcha = await await execRecaptcha()
    if (recaptcha === undefined) {
      return
    }

    const promise = toast.promise(
      apiRequest('POST', `/api/challenge/${challengeId}/delete`, {
        recaptcha,
      }),
      {
        pending: 'Stopping instance',
        success: 'Instance stopping',
        error: {
          render({ data }) {
            return data?.message ?? 'Could not stop instance'
          },
        },
      }
    )
    mutate(promise, {
      optimisticData: produce(data, (draft) => {
        draft.status = 'Stopping'
        delete draft.server
        delete draft.time
      }),
      rollbackOnError: true,
      revalidate: true,
      populateCache: true,
    }).catch(() => {})
  }

  if (error?.status === 401) {
    return (
      <>
        <h1>Unauthenticated</h1>
        <p>You are currently unauthenticated.</p>
        <AuthButton className="btn btn-auth" onAuthSuccess={handleAuth}>
          Authenticate
        </AuthButton>
      </>
    )
  }

  if (error?.status === 404) {
    return (
      <>
        <h1>{error.info.error}</h1>
        <p>{error.info.message}</p>
      </>
    )
  }

  if (!data) {
    return (
      <>
        <h1>Loading</h1>
        <p>Waiting for challenge data...</p>
        <Spinner className="status-spinner" />
      </>
    )
  }

  return (
    <>
      <h1>{data.name}</h1>
      <span
        className={classnames(
          'status-text',
          `status-${data.status.toLowerCase()}`
        )}
      >
        {data.status}
      </span>
      {data.server && <Server {...data.server} />}
      {data.additionalServers && data.additionalServers.length > 0 && (
        <div className="additional-servers">
          <h3>Additional Services</h3>
          <div className="servers-list">
            {data.additionalServers.map((server, index) => (
              <div key={index} className="server-item">
                {server.name && <div className="server-name">{server.name}</div>}
                <Server {...server} />
              </div>
            ))}
          </div>
        </div>
      )}
      {data.time && (
        <p>
          Stopping <TimeAgo future date={data.time.stop} />
        </p>
      )}
      {data.status === 'Stopped' && (
        <Button className="btn-start" onClick={handleStart}>
          Start
        </Button>
      )}
      {data.status !== 'Stopped' && data.status !== 'Stopping' && (
        <Button className="btn-stop" onClick={handleStop}>
          Stop
        </Button>
      )}
      {(data.status === 'Starting' || data.status === 'Stopping') && (
        <Spinner
          className={classnames(
            'status-spinner',
            'status-' + data.status.toLowerCase()
          )}
        />
      )}
      <ReCAPTCHA
        ref={recaptchaRef}
        theme={theme}
        sitekey={config.recaptcha}
        badge="bottomright"
        size="invisible"
      />
    </>
  )
}

export default Challenge
