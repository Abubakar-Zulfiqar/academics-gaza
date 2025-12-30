import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'

interface Topic {
  keyword: string
  status: string
}

export async function GET() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('accessToken')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(token)
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get all data for analytics
    const [students, volunteers, matches, sessions] = await Promise.all([
      prisma.student.findMany({
        select: {
          id: true,
          cause: true,
          fieldsOfStudy: true,
          topicsNeedSupport: true,
          createdAt: true,
        },
      }),
      prisma.volunteer.findMany({
        select: {
          id: true,
          causes: true,
          fieldsOfExpertise: true,
          subjectsQualified: true,
          totalHoursVolunteered: true,
          studentsHelped: true,
          currentCapacity: true,
          maxCapacity: true,
          createdAt: true,
        },
      }),
      prisma.match.findMany({
        select: {
          id: true,
          status: true,
          assignedSubjects: true,
          studentId: true,
          volunteerId: true,
          createdAt: true,
        },
      }),
      prisma.session.findMany({
        select: {
          id: true,
          status: true,
          durationMinutes: true,
          subjectsCovered: true,
          scheduledAt: true,
        },
      }),
    ])

    // Cause distribution
    const causeDistribution: Record<string, { students: number; volunteers: number }> = {}
    students.forEach((s: any) => {
      if (!causeDistribution[s.cause]) {
        causeDistribution[s.cause] = { students: 0, volunteers: 0 }
      }
      causeDistribution[s.cause].students++
    })
    volunteers.forEach((v: any) => {
      // Volunteers can support multiple causes
      v.causes.forEach((cause: any) => {
        if (!causeDistribution[cause]) {
          causeDistribution[cause] = { students: 0, volunteers: 0 }
        }
        causeDistribution[cause].volunteers++
      })
    })

    // Match status distribution
    const matchStatusDistribution: Record<string, number> = {}
    matches.forEach((m: any) => {
      matchStatusDistribution[m.status] = (matchStatusDistribution[m.status] || 0) + 1
    })

    // Topic coverage
    let totalTopics = 0
    let assignedTopics = 0
    students.forEach((s: any) => {
      const topics = (s.topicsNeedSupport as unknown as Topic[]) || []
      totalTopics += topics.length
      assignedTopics += topics.filter((t: any) => t.status === 'assigned').length
    })

    // Sessions over time (last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const sessionsOverTime: Record<string, { scheduled: number; completed: number }> = {}
    const recentSessions = sessions.filter((s: any) => s.scheduledAt && new Date(s.scheduledAt) >= thirtyDaysAgo)

    recentSessions.forEach((s: any) => {
      const dateKey = s.scheduledAt ? new Date(s.scheduledAt).toISOString().split('T')[0] : ''
      if (!dateKey) return
      if (!sessionsOverTime[dateKey]) {
        sessionsOverTime[dateKey] = { scheduled: 0, completed: 0 }
      }
      if (s.status === 'completed') {
        sessionsOverTime[dateKey].completed++
      } else if (s.status === 'scheduled') {
        sessionsOverTime[dateKey].scheduled++
      }
    })

    // Total hours
    const totalHours = volunteers.reduce((acc: number, v: any) => acc + v.totalHoursVolunteered, 0)

    // Popular subjects
    const subjectCounts: Record<string, number> = {}
    matches.forEach((m: any) => {
      m.assignedSubjects.forEach((subject: any) => {
        subjectCounts[subject] = (subjectCounts[subject] || 0) + 1
      })
    })
    const popularSubjects = Object.entries(subjectCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([subject, count]) => ({ subject, count }))

    // Registrations over time (last 30 days)
    const registrationsOverTime: Record<string, { students: number; volunteers: number }> = {}
    students
      .filter((s: any) => new Date(s.createdAt) >= thirtyDaysAgo)
      .forEach((s: any) => {
        const dateKey = new Date(s.createdAt).toISOString().split('T')[0]
        if (!registrationsOverTime[dateKey]) {
          registrationsOverTime[dateKey] = { students: 0, volunteers: 0 }
        }
        registrationsOverTime[dateKey].students++
      })
    volunteers
      .filter((v: any) => new Date(v.createdAt) >= thirtyDaysAgo)
      .forEach((v: any) => {
        const dateKey = new Date(v.createdAt).toISOString().split('T')[0]
        if (!registrationsOverTime[dateKey]) {
          registrationsOverTime[dateKey] = { students: 0, volunteers: 0 }
        }
        registrationsOverTime[dateKey].volunteers++
      })

    // Field frequency analysis
    const studentFieldCounts: Record<string, number> = {}
    const volunteerFieldCounts: Record<string, number> = {}

    students.forEach((s: any) => {
      s.fieldsOfStudy.forEach((field: any) => {
        const normalizedField = field.toLowerCase().trim()
        studentFieldCounts[normalizedField] = (studentFieldCounts[normalizedField] || 0) + 1
      })
    })

    volunteers.forEach((v: any) => {
      v.fieldsOfExpertise.forEach((field: any) => {
        const normalizedField = field.toLowerCase().trim()
        volunteerFieldCounts[normalizedField] = (volunteerFieldCounts[normalizedField] || 0) + 1
      })
    })

    // Create field demand analysis (fields with high student demand vs volunteer supply)
    const allFields = new Set([
      ...Object.keys(studentFieldCounts),
      ...Object.keys(volunteerFieldCounts),
    ])

    const fieldDemandAnalysis = Array.from(allFields).map((field) => ({
      field: field.charAt(0).toUpperCase() + field.slice(1),
      studentDemand: studentFieldCounts[field] || 0,
      volunteerSupply: volunteerFieldCounts[field] || 0,
      gap: (studentFieldCounts[field] || 0) - (volunteerFieldCounts[field] || 0),
    })).sort((a, b) => b.gap - a.gap)

    // Subject demand analysis (topics students need vs subjects volunteers offer)
    const topicDemand: Record<string, { demand: number; assigned: number }> = {}
    students.forEach((s: any) => {
      const topics = (s.topicsNeedSupport as unknown as Topic[]) || []
      topics.forEach((topic: any) => {
        const normalizedTopic = topic.keyword.toLowerCase().trim()
        if (!topicDemand[normalizedTopic]) {
          topicDemand[normalizedTopic] = { demand: 0, assigned: 0 }
        }
        topicDemand[normalizedTopic].demand++
        if (topic.status === 'assigned') {
          topicDemand[normalizedTopic].assigned++
        }
      })
    })

    const volunteerSubjectCounts: Record<string, number> = {}
    volunteers.forEach((v: any) => {
      v.subjectsQualified.forEach((subject: any) => {
        const normalizedSubject = subject.toLowerCase().trim()
        volunteerSubjectCounts[normalizedSubject] = (volunteerSubjectCounts[normalizedSubject] || 0) + 1
      })
    })

    // High demand subjects (most requested by students)
    const subjectDemandAnalysis = Object.entries(topicDemand)
      .map(([subject, data]) => ({
        subject: subject.charAt(0).toUpperCase() + subject.slice(1),
        demand: data.demand,
        assigned: data.assigned,
        unassigned: data.demand - data.assigned,
        volunteerSupply: volunteerSubjectCounts[subject] || 0,
      }))
      .sort((a, b) => b.unassigned - a.unassigned)
      .slice(0, 15)

    // Volunteer capacity utilization
    const totalCapacity = volunteers.reduce((acc: number, v: any) => acc + v.maxCapacity, 0)
    const usedCapacity = volunteers.reduce((acc: number, v: any) => acc + v.currentCapacity, 0)
    const capacityUtilization = totalCapacity > 0
      ? Math.round((usedCapacity / totalCapacity) * 100)
      : 0

    // Volunteers at full capacity
    const volunteersAtFullCapacity = volunteers.filter(
      (v: any) => v.currentCapacity >= v.maxCapacity
    ).length

    // Volunteers with available capacity
    const volunteersWithCapacity = volunteers.filter(
      (v: any) => v.currentCapacity < v.maxCapacity
    ).length

    // Students with/without active matches
    const activeMatchStatuses = ['email_sent', 'accepted', 'active']
    const studentsWithActiveMatch = new Set(
      matches
        .filter((m: any) => activeMatchStatuses.includes(m.status))
        .map((m: any) => m.studentId)
    ).size
    const studentsWithoutMatch = students.length - studentsWithActiveMatch

    // Volunteers with/without active matches
    const volunteersWithActiveMatch = new Set(
      matches
        .filter((m: any) => activeMatchStatuses.includes(m.status))
        .map((m: any) => m.volunteerId)
    ).size
    const volunteersWithoutMatch = volunteers.length - volunteersWithActiveMatch

    // Top fields by student count
    const topStudentFields = Object.entries(studentFieldCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([field, count]) => ({
        field: field.charAt(0).toUpperCase() + field.slice(1),
        count,
      }))

    // Top fields by volunteer count
    const topVolunteerFields = Object.entries(volunteerFieldCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([field, count]) => ({
        field: field.charAt(0).toUpperCase() + field.slice(1),
        count,
      }))

    // Top volunteer subjects
    const topVolunteerSubjects = Object.entries(volunteerSubjectCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([subject, count]) => ({
        subject: subject.charAt(0).toUpperCase() + subject.slice(1),
        count,
      }))

    return NextResponse.json({
      overview: {
        totalStudents: students.length,
        totalVolunteers: volunteers.length,
        totalMatches: matches.length,
        activeMatches: matches.filter((m: any) => m.status === 'active').length,
        totalSessions: sessions.length,
        completedSessions: sessions.filter((s: any) => s.status === 'completed').length,
        totalHours: Math.round(totalHours * 10) / 10,
        topicCoverage: {
          total: totalTopics,
          assigned: assignedTopics,
          percentage: totalTopics > 0 ? Math.round((assignedTopics / totalTopics) * 100) : 0,
        },
        capacityUtilization,
        volunteersAtFullCapacity,
        volunteersWithCapacity,
        studentsWithActiveMatch,
        studentsWithoutMatch,
        volunteersWithActiveMatch,
        volunteersWithoutMatch,
      },
      causeDistribution: Object.entries(causeDistribution).map(([cause, data]) => ({
        cause,
        ...data,
      })),
      matchStatusDistribution: Object.entries(matchStatusDistribution).map(([status, count]) => ({
        status,
        count,
      })),
      popularSubjects,
      sessionsOverTime: Object.entries(sessionsOverTime)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      registrationsOverTime: Object.entries(registrationsOverTime)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      fieldDemandAnalysis,
      subjectDemandAnalysis,
      topStudentFields,
      topVolunteerFields,
      topVolunteerSubjects,
    })
  } catch (error) {
    console.error('Error fetching analytics:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
