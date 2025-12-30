import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function auditAllData() {
  console.log('=== DATA AUDIT ===\n')

  const volunteers = await prisma.volunteer.findMany({
    include: {
      matches: {
        include: {
          student: { select: { fullName: true } },
          sessions: true
        }
      }
    }
  })

  let issuesFound = false

  for (const v of volunteers as any[]) {
    const activeMatches = v.matches.filter((m: any) => ['accepted', 'active'].includes(m.status))
    const actualStudentsHelped = new Set(v.matches.filter((m: any) =>
      ['accepted', 'active', 'completed'].includes(m.status)
    ).map((m: any) => m.studentId)).size

    const totalMinutes = v.matches.flatMap((m: any) => m.sessions)
      .filter((s: any) => s.status === 'completed')
      .reduce((acc: number, s: any) => acc + (s.durationMinutes || 0), 0)
    const actualHours = Math.round(totalMinutes / 60 * 10) / 10

    const issues = []
    if (v.currentCapacity !== activeMatches.length) issues.push(`capacity: ${v.currentCapacity} -> ${activeMatches.length}`)
    if (v.studentsHelped !== actualStudentsHelped) issues.push(`studentsHelped: ${v.studentsHelped} -> ${actualStudentsHelped}`)
    if (v.totalHoursVolunteered !== actualHours) issues.push(`hours: ${v.totalHoursVolunteered} -> ${actualHours}`)

    if (issues.length > 0) {
      issuesFound = true
      console.log(`${v.fullName}: ISSUES FOUND`)
      issues.forEach((i: any) => console.log(`  - ${i}`))
    } else {
      console.log(`${v.fullName}: OK`)
    }
  }

  if (!issuesFound) {
    console.log('\nAll data is consistent!')
  }

  await prisma.$disconnect()
}

auditAllData()
