const gradesResponse = await fetch(`https://api.madgrades.com/v1/courses/42005236-400a-3791-b415-bb4b90d86323/grades`, {
    method: "GET",
    headers: {
        "Authorization": "Token token=db0b773feba0467688172d87b38f3f95",
        "Accept": "application/json"
    }
});

const gradesJson = await gradesResponse.json();


const calculateGrade = (grades) => {
    let total = 0
    let totalCount = 0
    total += grades.aCount * 4
    totalCount += grades.aCount
    total += grades.abCount * 3.5
    totalCount += grades.abCount
    total += grades.bCount * 3
    totalCount += grades.bCount
    total += grades.bcCount * 2.5
    totalCount += grades.bcCount
    total += grades.cCount * 2
    totalCount += grades.cCount
    total += grades.dCount * 1
    totalCount += grades.dCount
    totalCount += grades.fCount
    return total / totalCount
}

const ripOutCumulativeGradeAndMostRecentGrade = (grades) => {
    return {
        uuid: grades.courseUuid,
        cumulative: calculateGrade(grades.cumulative).toFixed(2),
        mostRecent: grades.courseOfferings && grades.courseOfferings.length > 0 
            ? calculateGrade(grades.courseOfferings[0].cumulative).toFixed(2)
            : null
    }
}



console.log(ripOutCumulativeGradeAndMostRecentGrade(gradesJson))