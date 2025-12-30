import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'

interface Topic {
  keyword: string
  status: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: matchId } = await params
    const cookieStore = await cookies()
    const token = cookieStore.get('accessToken')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(token)
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        student: true,
        volunteer: {
          include: {
            user: true,
          },
        },
      },
    })

    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }

    if (match.status !== 'pending_email') {
      return NextResponse.json(
        { error: 'Can only send email for pending matches' },
        { status: 400 }
      )
    }

    // Get email template
    const template = await prisma.emailTemplate.findFirst({
      where: { name: 'match_request' },
    })

    if (template) {
      // Replace template variables
      const topics = match.student.topicsNeedSupport as unknown as Topic[]
      const topicsList = topics
        .filter((t: any) => match.assignedSubjects.includes(t.keyword))
        .map((t: any) => `- ${t.keyword}`)
        .join('\n')

      const emailBody = template.body
        .replace(/\{\{volunteer_name\}\}/g, match.volunteer.fullName)
        .replace(/\{\{student_name\}\}/g, match.student.fullName)
        .replace(/\{\{cause\}\}/g, match.student.cause)
        .replace(/\{\{subjects\}\}/g, match.assignedSubjects.join(', '))
        .replace(/\{\{topics\}\}/g, topicsList)

      const emailSubject = template.subject
        .replace(/\{\{student_name\}\}/g, match.student.fullName)

      // In a real app, send the email here
      // For now, we just log it
      console.log('Sending email to:', match.volunteer.user.email)
      console.log('Subject:', emailSubject)
      console.log('Body:', emailBody)
    }

    // Update match status
    const updatedMatch = await prisma.match.update({
      where: { id: matchId },
      data: { status: 'email_sent' },
    })

    return NextResponse.json({
      match: {
        id: updatedMatch.id,
        status: updatedMatch.status,
      },
    })
  } catch (error) {
    console.error('Error sending match email:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
