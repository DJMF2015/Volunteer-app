import React from 'react'
import styled from 'styled-components/native';
import { AntDesign } from '@expo/vector-icons';


const ProjectHeading = () => {

    const ProjectHeadingView = styled.View`
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    `

    const ProjectTitle = styled.Text`
    font-weight: 700;
    font-size: 18px;
    `


    return (
        <ProjectHeadingView>
            <ProjectTitle>Project Title</ProjectTitle>
            <AntDesign name="hearto" size={20} /> 
        </ProjectHeadingView>

    )
}

export default ProjectHeading
