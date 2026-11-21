import { useMe } from '../../lib/auth'
import { PageHeader } from '../../components/ui'
import ProgressView from './ProgressView'

export default function MyProgressPage() {
  const me = useMe()
  return (
    <>
      <PageHeader title={`${me.full_name},你好`} subtitle="你的職級進度與下一級還差什麼" />
      <ProgressView techId={me.id} showLinks />
    </>
  )
}
