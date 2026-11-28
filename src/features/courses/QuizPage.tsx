import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '../../lib/supabase'
import type { Quiz, QuizQuestion, QuizResult } from '../../lib/types'
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, cx } from '../../components/ui'

export default function QuizPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [answers, setAnswers] = useState<Record<string, number>>({})

  const data = useQuery({
    queryKey: ['quiz', id],
    queryFn: async () => ({
      quiz: await unwrap(supabase.from('quizzes').select('*').eq('id', id!).single<Quiz>()),
      questions: await unwrap(supabase.from('quiz_questions').select('*').eq('quiz_id', id!)
        .order('sort_order').order('id').returns<QuizQuestion[]>()),
    }),
  })

  const submit = useMutation({
    mutationFn: () => {
      const arr = data.data!.questions.map((q) => answers[q.id] ?? null)
      return unwrap(supabase.rpc('submit_quiz', { p_quiz_id: id, p_answers: arr })) as Promise<QuizResult>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course'] })
      qc.invalidateQueries({ queryKey: ['course_completions'] })
      qc.invalidateQueries({ queryKey: ['promotion_progress'] })
    },
  })

  if (data.isLoading) return <Loading />
  if (data.error) return <ErrorBox error={data.error} />
  const { quiz, questions } = data.data!
  const result = submit.data
  const resultOf = (qid: string) => result?.results.find((r) => r.question_id === qid)
  const allAnswered = questions.every((q) => answers[q.id] !== undefined)

  return (
    <>
      <PageHeader title={quiz.title} subtitle={`共 ${questions.length} 題・${quiz.pass_score} 分及格`} />
      {result && (
        <Card className={cx('mb-4 text-center', result.passed ? 'border-ok' : 'border-warn')}>
          <div className="text-4xl font-bold tabular-nums">{result.score} 分</div>
          <div className="mt-1">{result.passed ? <Badge tone="ok">及格 🎉</Badge> : <Badge tone="warn">未及格,再接再厲</Badge>}</div>
          <div className="mt-2 text-sm text-muted">答對 {result.correct} / {result.total} 題</div>
          <div className="mt-3 flex justify-center gap-4 text-sm">
            {!result.passed && <button className="text-brand" onClick={() => { setAnswers({}); submit.reset(); window.scrollTo(0, 0) }}>重新作答</button>}
            <Link to={`/courses/${quiz.course_id}`} className="text-brand">回到課程 →</Link>
          </div>
        </Card>
      )}
      <ol className="space-y-3">
        {questions.map((q, i) => {
          const r = resultOf(q.id)
          return (
            <li key={q.id}>
              <Card className={cx(r && (r.correct ? 'border-ok' : 'border-danger'))}>
                <div className="mb-3 font-medium">{i + 1}. {q.prompt} {r && (r.correct ? '✅' : '❌')}</div>
                <div className="space-y-2">
                  {q.options.map((opt, oi) => {
                    const isAnswer = r?.correct_index === oi
                    const isWrongPick = r && !r.correct && answers[q.id] === oi
                    return (
                      <label key={oi} className={cx('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                        isAnswer ? 'border-ok bg-ok-soft' : isWrongPick ? 'border-danger bg-danger-soft' : answers[q.id] === oi ? 'border-brand bg-brand-soft' : 'border-line')}>
                        <input type="radio" name={q.id} className="size-4 shrink-0" disabled={Boolean(result)}
                          checked={answers[q.id] === oi} onChange={() => setAnswers({ ...answers, [q.id]: oi })} />
                        <span className="flex-1">{opt}</span>
                        {isAnswer && <span className="shrink-0 text-xs font-medium text-ok">正解</span>}
                      </label>
                    )
                  })}
                </div>
                {r?.explanation && (
                  <p className="mt-3 rounded-lg bg-subtle p-3 text-sm leading-relaxed"><b>解說:</b>{r.explanation}</p>
                )}
              </Card>
            </li>
          )
        })}
      </ol>
      <ErrorBox error={submit.error} />
      {!result && (
        <Button className="mt-4 w-full" disabled={!allAnswered || submit.isPending} onClick={() => submit.mutate()}>
          {allAnswered ? '交卷' : `尚有 ${questions.filter((q) => answers[q.id] === undefined).length} 題未作答`}
        </Button>
      )}
    </>
  )
}
