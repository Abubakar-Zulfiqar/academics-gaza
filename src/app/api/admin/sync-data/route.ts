import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function POST() {
  try {
    const session = await getSession()

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const volunteers = await prisma.volunteer.findMany({
      include: {
        matches: {
          include: {
            sessions: true
          }
        }
      }
    })

    const fixes: Array<{ name: string; changes: string[] }> = []

    for (const v of volunteers) {
      // Calculate actual values from related data
      const actualCapacity = v.matches.filter((m: typeof v.matches[number]) => ['accepted', 'active'].includes(m.status)).length
      const actualStudentsHelped = new Set(v.matches.filter((m: typeof v.matches[number]) =>
        ['accepted', 'active', 'completed'].includes(m.status)
      ).map((m: typeof v.matches[number]) => m.studentId)).size

      const totalMinutes = v.matches.flatMap((m: typeof v.matches[number]) => m.sessions)
        .filter((s: typeof v.matches[number]['sessions'][number]) => s.status === 'completed')
        .reduce((acc: number, s: typeof v.matches[number]['sessions'][number]) => acc + (s.durationMinutes || 0), 0)
      const actualHours = Math.round(totalMinutes / 60 * 10) / 10

      // Check if update needed
      const changes: string[] = []
      if (v.currentCapacity !== actualCapacity) {
        changes.push(`capacity: ${v.currentCapacity} -> ${actualCapacity}`)
      }
      if (v.studentsHelped !== actualStudentsHelped) {
        changes.push(`studentsHelped: ${v.studentsHelped} -> ${actualStudentsHelped}`)
      }
      if (v.totalHoursVolunteered !== actualHours) {
        changes.push(`hours: ${v.totalHoursVolunteered} -> ${actualHours}`)
      }

      if (changes.length > 0) {
        await prisma.volunteer.update({
          where: { id: v.id },
          data: {
            currentCapacity: actualCapacity,
            studentsHelped: actualStudentsHelped,
            totalHoursVolunteered: actualHours
          }
        })
        fixes.push({ name: v.fullName, changes })
      }
    }

    return NextResponse.json({
      success: true,
      message: fixes.length > 0
        ? `Fixed ${fixes.length} volunteer(s)`
        : 'All data is already in sync',
      fixes
    })
  } catch (error) {
    console.error('Error syncing data:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
