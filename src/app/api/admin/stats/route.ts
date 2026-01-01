import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'

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

    // Get total counts
    const [totalStudents, totalVolunteers, allMatches, allVolunteers, allStudents] = await Promise.all([
      prisma.student.count(),
      prisma.volunteer.count(),
      prisma.match.findMany({
        include: {
          student: { select: { fullName: true, cause: true } },
          volunteer: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.volunteer.findMany({
        select: { currentCapacity: true, maxCapacity: true, causes: true },
      }),
      prisma.student.findMany({
        select: { topicsNeedSupport: true, cause: true },
      }),
    ])

    const activeMatches = allMatches.filter((m: typeof allMatches[number]) => m.status === 'active').length
    const pendingMatches = allMatches.filter((m: typeof allMatches[number]) =>
      ['pending_email', 'email_sent', 'auto_suggested'].includes(m.status)
    ).length

    // Get pending action breakdown
    const pendingActions = {
      autoSuggested: allMatches.filter((m: typeof allMatches[number]) => m.status === 'auto_suggested').length,
      pendingEmail: allMatches.filter((m: typeof allMatches[number]) => m.status === 'pending_email').length,
      emailSent: allMatches.filter((m: typeof allMatches[number]) => m.status === 'email_sent').length,
    }

    // Get students with unassigned topics
    let assignedTopics = 0
    let unassignedTopics = 0
    let studentsNeedingAssignment = 0

    allStudents.forEach((student: any) => {
      const topics = student.topicsNeedSupport as Array<{ status: string }> || []
      const hasUnassigned = topics.some((t: any) => t.status === 'unassigned')
      if (hasUnassigned) studentsNeedingAssignment++
      topics.forEach((t: any) => {
        if (t.status === 'assigned') assignedTopics++
        else unassignedTopics++
      })
    })

    // Get available volunteer capacity
    const volunteerCapacityAvailable = allVolunteers.reduce(
      (acc: number, v: typeof allVolunteers[number]) => acc + Math.max(0, v.maxCapacity - v.currentCapacity),
      0
    )

    // Get cause breakdown
    const causeMap = new Map<string, { students: number; volunteers: number }>()

    allStudents.forEach((student: any) => {
      const existing = causeMap.get(student.cause) || { students: 0, volunteers: 0 }
      causeMap.set(student.cause, { ...existing, students: existing.students + 1 })
    })

    allVolunteers.forEach((volunteer: any) => {
      // Volunteers can support multiple causes
      volunteer.causes.forEach((cause: any) => {
        const existing = causeMap.get(cause) || { students: 0, volunteers: 0 }
        causeMap.set(cause, { ...existing, volunteers: existing.volunteers + 1 })
      })
    })

    const causeBreakdown = Array.from(causeMap.entries()).map(([cause, counts]: [string, { students: number; volunteers: number }]) => ({
      cause,
      students: counts.students,
      volunteers: counts.volunteers,
    }))

    // Get recent matches with more details
    const recentMatches = allMatches.slice(0, 8).map((match: typeof allMatches[number]) => ({
      id: match.id,
      status: match.status,
      matchScore: match.matchScore,
      createdAt: match.createdAt.toISOString(),
      student: { fullName: match.student.fullName, cause: match.student.cause },
      volunteer: { fullName: match.volunteer.fullName },
      assignedSubjects: match.assignedSubjects,
    }))

    return NextResponse.json({
      totalStudents,
      totalVolunteers,
      activeMatches,
      pendingMatches,
      studentsNeedingAssignment,
      volunteerCapacityAvailable,
      recentMatches,
      topicsCoverage: {
        assigned: assignedTopics,
        unassigned: unassignedTopics,
      },
      pendingActions,
      causeBreakdown,
    })
  } catch (error) {
    console.error('Error fetching admin stats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
